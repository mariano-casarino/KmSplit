import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { interval, take } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import { GoogleAuthService } from '../../../core/services/google-auth.service';
import { SessionResumeService } from '../../../core/services/session-resume.service';

/** La intro: K y S aparecen, se arma el wordmark y a los 1,5 s vuela al
 *  lugar del logo real. A los 2,15 s se desvanece y a los 2,48 s se saca. */
const INTRO_FLIGHT_AT = 1500;
const INTRO_FADE_AT = 2150;
const INTRO_END_AT = 2480;

@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements AfterViewInit {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private googleAuth = inject(GoogleAuthService);
  private router = inject(Router);
  private sessionResume = inject(SessionResumeService);
  private destroyRef = inject(DestroyRef);

  private loginTitle = viewChild<ElementRef<HTMLElement>>('loginTitle');
  private introWordmark = viewChild<ElementRef<HTMLElement>>('introWordmark');

  /** Intro de entrada (la K, después la S y el vuelo al logo del login).
   *  Se saltea si el usuario pidió menos movimiento. */
  introActive = signal(!LoginComponent.prefersReducedMotion());
  introFlying = signal(false);
  introDone = signal(false);
  private introTimers: ReturnType<typeof setTimeout>[] = [];

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

  ngAfterViewInit(): void {
    this.destroyRef.onDestroy(() => this.clearIntroTimers());
    if (!this.introActive()) return;

    const wordmark = this.introWordmark()?.nativeElement;
    const title = this.loginTitle()?.nativeElement;

    // Sin medidas (tests sin layout, navegadores raros) la intro no aporta
    // nada: mejor sacarla en el próximo tick y dejar el login limpio.
    if (!wordmark || !title || !this.layoutIntro(wordmark, title)) {
      this.scheduleIntro(() => this.introActive.set(false), 0);
      return;
    }

    this.scheduleIntro(() => this.introFlying.set(true), INTRO_FLIGHT_AT);
    this.scheduleIntro(() => this.introDone.set(true), INTRO_FADE_AT);
    this.scheduleIntro(() => this.introActive.set(false), INTRO_END_AT);
  }

  /** Tocar la intro la saltea: corta los timers y la desvanece rápido. */
  skipIntro(): void {
    if (!this.introActive()) return;

    this.clearIntroTimers();
    this.introDone.set(true);
    this.scheduleIntro(() => this.introActive.set(false), 300);
  }

  private scheduleIntro(action: () => void, delay: number): void {
    this.introTimers.push(setTimeout(action, delay));
  }

  private clearIntroTimers(): void {
    this.introTimers.forEach((timer) => clearTimeout(timer));
    this.introTimers = [];
  }

  /**
   * Mide el wordmark grande (con todas las letras) y el logo real del login.
   * Deja en variables CSS el ancho de la S, la m y "plit" (los keyframes los
   * despliegan) y el desplazamiento/escala del vuelo final.
   */
  private layoutIntro(wordmark: HTMLElement, title: HTMLElement): boolean {
    const sizes = this.measureWordmark(wordmark);
    const target = title.getBoundingClientRect();

    if (sizes.full <= 0 || target.width <= 0) return false;

    wordmark.style.setProperty('--intro-s-w', `${sizes.s}px`);
    wordmark.style.setProperty('--intro-m-w', `${sizes.m}px`);
    wordmark.style.setProperty('--intro-plit-w', `${sizes.plit}px`);

    // El wordmark se agranda simétricamente desde el centro, así que el
    // centro actual (con la K sola) es el mismo que tendrá ya armado.
    const start = wordmark.getBoundingClientRect();
    const startCenterX = start.left + start.width / 2;
    const startCenterY = start.top + start.height / 2;

    const targetCenterX = target.left + target.width / 2;
    const targetCenterY = target.top + target.height / 2;

    wordmark.style.setProperty('--intro-dx', `${targetCenterX - startCenterX}px`);
    wordmark.style.setProperty('--intro-dy', `${targetCenterY - startCenterY}px`);
    wordmark.style.setProperty('--intro-scale', `${target.width / sizes.full}`);

    return true;
  }

  /** Copia oculta del wordmark para medir el ancho natural de cada parte. */
  private measureWordmark(wordmark: HTMLElement): {
    full: number;
    s: number;
    m: number;
    plit: number;
  } {
    const clone = wordmark.cloneNode(true) as HTMLElement;
    clone.style.position = 'fixed';
    clone.style.left = '0';
    clone.style.top = '0';
    clone.style.visibility = 'hidden';
    clone.style.pointerEvents = 'none';
    clone.style.transition = 'none';

    clone.querySelectorAll<HTMLElement>('.intro-char').forEach((char) => {
      char.style.animation = 'none';
      char.style.opacity = '1';
      char.style.maxWidth = 'none';
      char.style.overflow = 'visible';
    });

    document.body.appendChild(clone);

    const full = clone.getBoundingClientRect().width;
    const s =
      clone.querySelector<HTMLElement>('.intro-s')?.getBoundingClientRect()
        .width ?? 0;
    const m =
      clone.querySelector<HTMLElement>('.intro-m')?.getBoundingClientRect()
        .width ?? 0;
    const plit =
      clone.querySelector<HTMLElement>('.intro-plit')?.getBoundingClientRect()
        .width ?? 0;

    clone.remove();

    return { full, s, m, plit };
  }

  /** Detecta accesibilidad: evitar la intro si se pidió menos movimiento. */
  private static prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

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
