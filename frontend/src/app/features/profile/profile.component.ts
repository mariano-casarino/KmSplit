import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { User } from '../../core/models/user.model';
import { AuthService } from '../../core/services/auth.service';
import { GroupService } from '../../core/services/group.service';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { BackButtonComponent } from '../../shared/back-button/back-button.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { DangerButtonComponent } from '../../shared/danger-button/danger-button.component';
import { fileToCompressedDataUri } from '../../shared/utils/image.util';

type Feedback = { type: 'success' | 'error'; text: string } | null;

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, AvatarComponent, BackButtonComponent, ConfirmDialogComponent, DangerButtonComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private groups = inject(GroupService);

  /** Desde dónde se abrió el perfil: 'grupos' (selector) o 'vehiculos' (dentro
   *  de un grupo). Determina a dónde vuelve el botón de atrás. */
  private readonly from = this.route.snapshot.queryParamMap.get('from') ?? 'grupos';

  user = signal<User | null>(this.auth.getCurrentUser());
  loading = signal(this.user() === null);

  savingProfile = signal(false);
  profileFeedback = signal<Feedback>(null);

  avatarSaving = signal(false);
  avatarFeedback = signal<Feedback>(null);
  private avatarTimer: ReturnType<typeof setTimeout> | null = null;

  savingPassword = signal(false);
  passwordFeedback = signal<Feedback>(null);

  showCurrentPassword = signal(false);
  showNewPassword = signal(false);
  showConfirmPassword = signal(false);

  pendingLogout = signal(false);
  loggingOut = signal(false);

  profileForm = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
    first_name: [''],
    last_name: [''],
  });

  passwordForm = this.fb.nonNullable.group(
    {
      current_password: ['', [Validators.required]],
      new_password: ['', [Validators.required, Validators.minLength(8)]],
      confirm_password: ['', [Validators.required]],
    },
    { validators: (group) => (group.get('new_password') && group.get('confirm_password')?.value === group.get('new_password')?.value
      ? null
      : { passwordMismatch: true }) },
  );

  constructor() {
    if (this.user() === null) {
      this.auth.fetchMe().subscribe({
        next: (user) => {
          this.user.set(user);
          this.patchProfileForm(user);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.router.navigate(['/grupos/selector']);
        },
      });
    } else {
      this.patchProfileForm(this.user()!);
    }
  }

  /** Dónde vuelve el botón de atrás según dónde se abrió el perfil. */
  backRoute(): (string | number)[] {
    return this.from === 'vehiculos'
      ? ['/vehiculos']
      : ['/grupos', 'selector'];
  }

  private patchProfileForm(user: User): void {
    this.profileForm.patchValue({
      name: user.name,
      first_name: user.first_name,
      last_name: user.last_name,
    });
  }

  /** Apodo que se muestra en el avatar: nombre real + apellido (o apodo si no hay). */
  displayAvatar(): string {
    const user = this.user();
    if (!user) return '';
    const source = user.first_name?.trim() || user.name?.trim() || '';
    const last = user.last_name?.trim() ?? '';
    return [source, last].filter(Boolean).join(' ').trim();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    // resetemos el input para poder elegir la misma foto de nuevo
    input.value = '';

    this.avatarSaving.set(true);
    this.avatarFeedback.set(null);
    this.clearAvatarTimer();

    fileToCompressedDataUri(file)
      .then((dataUri) => this.saveAvatar(dataUri))
      .catch((err: Error) => {
        this.avatarSaving.set(false);
        this.avatarFeedback.set({ type: 'error', text: err.message });
      });
  }

  removeAvatar(): void {
    this.avatarSaving.set(true);
    this.avatarFeedback.set(null);
    this.clearAvatarTimer();
    this.saveAvatar('');
  }

  private saveAvatar(avatarUrl: string): void {
    const user = this.user();
    if (!user) return;

    const { name, first_name, last_name } = this.profileForm.getRawValue();
    this.auth.updateProfile({ name, first_name, last_name, avatar_url: avatarUrl }).subscribe({
      next: (updated) => {
        this.user.set(updated);
        this.avatarSaving.set(false);
        this.avatarFeedback.set({
          type: 'success',
          text: avatarUrl ? 'Foto de perfil actualizada.' : 'Foto eliminada.',
        });
        // la foto del integrante vive en el grupo cacheado: refrescalo para que
        // la lista de integrantes del vehículo muestre la foto nueva al toque
        this.groups.invalidate();
        // el mensaje de éxito se oculta solo tras 3 segundos
        this.clearAvatarTimer();
        this.avatarTimer = setTimeout(() => this.avatarFeedback.set(null), 3000);
      },
      error: (err) => {
        this.avatarSaving.set(false);
        this.avatarFeedback.set({
          type: 'error',
          text: err.error?.avatar_url?.[0] ?? 'No pudimos guardar la foto.',
        });
      },
    });
  }

  private clearAvatarTimer(): void {
    if (this.avatarTimer) {
      clearTimeout(this.avatarTimer);
      this.avatarTimer = null;
    }
  }

  saveProfile(): void {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }
    const { name, first_name, last_name } = this.profileForm.getRawValue();
    this.savingProfile.set(true);
    this.profileFeedback.set(null);

    this.auth.updateProfile({ name, first_name, last_name }).subscribe({
      next: (user) => {
        this.user.set(user);
        this.savingProfile.set(false);
        this.profileFeedback.set({ type: 'success', text: 'Perfil actualizado.' });
        // el apodo aparece en los grupos cacheados (integrantes, historial)
        this.groups.invalidate();
      },
      error: (err) => {
        this.savingProfile.set(false);
        this.profileFeedback.set({ type: 'error', text: this.apiError(err) });
      },
    });
  }

  changePassword(): void {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    const raw = this.passwordForm.getRawValue();
    if (raw.new_password !== raw.confirm_password) {
      this.passwordFeedback.set({ type: 'error', text: 'Las contraseñas no coinciden.' });
      return;
    }

    this.savingPassword.set(true);
    this.passwordFeedback.set(null);

    this.auth.changePassword(raw).subscribe({
      next: ({ detail }) => {
        this.savingPassword.set(false);
        this.passwordFeedback.set({ type: 'success', text: detail });
        this.passwordForm.reset();
      },
      error: (err) => {
        this.savingPassword.set(false);
        this.passwordFeedback.set({ type: 'error', text: this.apiError(err) });
      },
    });
  }

  requestLogout(): void {
    this.pendingLogout.set(true);
  }

  cancelLogout(): void {
    this.pendingLogout.set(false);
  }

  confirmLogout(): void {
    this.loggingOut.set(true);
    this.auth.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login']),
      complete: () => this.loggingOut.set(false),
    });
  }

  private apiError(err: { error?: Record<string, unknown> }): string {
    const body = err.error ?? {};
    const detail = body['detail'];
    if (typeof detail === 'string') return detail;
    const messages = Object.values(body).flat() as string[];
    if (messages.length) return messages.join(' ');
    return 'No pudimos guardar los cambios. Intentalo de nuevo.';
  }
}