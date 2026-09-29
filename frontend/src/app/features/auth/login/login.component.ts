import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { interval, take } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import { GoogleAuthService } from '../../../core/services/google-auth.service';
import { SessionResumeService } from '../../../core/services/session-resume.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private googleAuth = inject(GoogleAuthService);
  private router = inject(Router);
  private sessionResume = inject(SessionResumeService);
  private destroyRef = inject(DestroyRef);

  loading = signal(false);
  errorMessage = signal<string | null>(null);
  lockoutSeconds = signal<number | null>(null);
  showPassword = signal(false);

  /** Botón de Google solo aparece si hay client_id configurado. */
  googleEnabled = this.googleAuth.enabled;
  googleLoading = signal(false);
  googleError = signal<string | null>(null);

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
    rememberMe: [true],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const { email, password, rememberMe } = this.form.getRawValue();

    this.auth.login({ email, password, remember: rememberMe }).subscribe({
      next: () => {
        this.auth.fetchMe().subscribe({
          next: () => this.resume(),
          error: () => this.resume(),
        });
      },
      error: (err) => {
        this.unlock();

        if (err.status === 429) {
          const seconds = err.error?.retry_after_seconds ?? 60;
          this.startLockoutCountdown(seconds);
        } else if (err.status === 400 || err.status === 401) {
          this.errorMessage.set('Email o contraseña incorrectos.');
        } else {
          const detail = err.error?.detail;
          this.errorMessage.set(
            detail
              ? String(detail)
              : `No pudimos conectar con el servidor (${err.status ?? 'error'}). Intentalo de nuevo.`,
          );
        }
      },
    });
  }

  formattedLockout(): string {
    const s = this.lockoutSeconds();
    if (s === null) return '';
    const minutes = Math.floor(s / 60);
    const seconds = s % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /** Inicia sesión con Google: obtiene el id_token del popup de Google y lo
   *  manda al backend, que vincula por email la cuenta existente (si la hay) o
   *  crea una nueva, y sincroniza la foto del perfil de Google. */
  loginWithGoogle(): void {
    if (this.googleLoading()) return;
    // También se marca `loading`: mientras Google responde y la app reanuda la
    // sesión, el formulario entero queda bloqueado y no se puede disparar un
    // login por email en paralelo.
    this.googleLoading.set(true);
    this.loading.set(true);
    this.errorMessage.set(null);
    this.googleError.set(null);

    this.googleAuth.signIn().then(
      (credential) => {
        this.auth
          .googleLogin({
            credential,
            remember: this.form.controls.rememberMe.value,
          })
          .subscribe({
            next: () => this.finishGoogleLogin(),
            error: (err) => this.failGoogle(err),
          });
      },
      (err) => this.failGoogle(err),
    );
  }

  private finishGoogleLogin(): void {
    // El botón sigue en "Ingresando con Google..." hasta que navegamos: si se
    // destraba acá, vuelve a decir "Continuar con Google" mientras la app todavía
    // está reanudando, y el usuario lo interpreta como un fallo.
    this.auth.fetchMe().subscribe({
      next: () => this.resume(),
      error: () => this.resume(),
    });
  }

  private failGoogle(err: unknown): void {
    this.unlock();
    const status = (err as { status?: number })?.status;
    const detail = (err as { error?: { detail?: string } })?.error?.detail;
    if (err instanceof Error && status === undefined) {
      this.googleError.set(err.message);
    } else if (status === 503) {
      this.googleError.set(
        String(detail ?? 'Google no está habilitado en este servidor.'),
      );
    } else if (status === 400) {
      this.googleError.set(String(detail ?? 'No pudimos iniciar sesión con Google.'));
    } else {
      this.googleError.set(
        detail
          ? String(detail)
          : `No pudimos conectar con el servidor (${status ?? 'error'}). Intentalo de nuevo.`,
      );
    }
  }

  /** Tras loguear, intenta volver al último vehículo (si existe el contexto);
   *  si la reanudación falla, cae al selector de grupos. */
  private resume(): void {
    this.sessionResume.resumeRoute().subscribe({
      next: (route) => this.navigate(route),
      error: () => this.navigate(['/grupos/selector']),
    });
  }

  private navigate(route: string[]): void {
    this.router.navigate(route).then(
      (ok) => {
        // Navegar bien destruye el componente y el estado no importa. Si la
        // navegación no ocurre (guard, ruta caída) sí hay que destrabar.
        if (!ok) this.unlock();
      },
      () => this.unlock(),
    );
  }

  /** Destraba el formulario. Solo se usa cuando algo falló de verdad. */
  private unlock(): void {
    this.loading.set(false);
    this.googleLoading.set(false);
  }

  private startLockoutCountdown(seconds: number): void {
    this.errorMessage.set(null);
    this.lockoutSeconds.set(seconds);

    interval(1000)
      .pipe(take(seconds), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const current = this.lockoutSeconds();
          if (current !== null && current > 0) {
            this.lockoutSeconds.set(current - 1);
          }
        },
        complete: () => this.lockoutSeconds.set(null),
      });
  }
}
