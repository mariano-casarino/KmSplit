import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../../core/services/auth.service';
import { BackButtonComponent } from '../../../shared/back-button/back-button.component';

type ResetStep = 'email' | 'code' | 'password' | 'done';

function passwordsMatchValidator(): ValidatorFn {
  return (group) => {
    const password = group.get('new_password')?.value;
    const confirm = group.get('confirm_password')?.value;
    return password === confirm ? null : { passwordMismatch: true };
  };
}

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, BackButtonComponent],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss',
})
export class ForgotPasswordComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  step = signal<ResetStep>('email');
  email = signal('');
  code = signal('');
  loading = signal(false);
  errorMessage = signal<string | null>(null);

  emailForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  codeForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  passwordForm = this.fb.nonNullable.group(
    {
      new_password: ['', [Validators.required, Validators.minLength(8)]],
      confirm_password: ['', Validators.required],
    },
    { validators: passwordsMatchValidator() },
  );

  showPassword = signal(false);
  showConfirmPassword = signal(false);

  requestCode(): void {
    if (this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      return;
    }

    const email = this.emailForm.controls.email.value.trim().toLowerCase();
    this.loading.set(true);
    this.errorMessage.set(null);

    this.auth.requestPasswordReset({ email }).subscribe({
      next: () => {
        this.loading.set(false);
        this.email.set(email);
        this.step.set('code');
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err.error?.detail ?? 'No pudimos enviar el código.');
      },
    });
  }

  resendCode(): void {
    this.requestCode();
  }

  verifyCode(): void {
    if (this.codeForm.invalid) {
      this.codeForm.markAllAsTouched();
      return;
    }

    const code = this.codeForm.controls.code.value;
    this.loading.set(true);
    this.errorMessage.set(null);

    this.auth.verifyPasswordResetCode({ email: this.email(), code }).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.valid) {
          this.code.set(code);
          this.step.set('password');
        } else {
          this.errorMessage.set('Código incorrecto.');
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err.error?.detail ?? 'Código incorrecto o vencido.');
      },
    });
  }

  confirmReset(): void {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const { new_password, confirm_password } = this.passwordForm.getRawValue();

    this.auth
      .confirmPasswordReset({
        email: this.email(),
        code: this.code(),
        new_password,
        confirm_password,
      })
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.step.set('done');
        },
        error: (err) => {
          this.loading.set(false);
          this.errorMessage.set(err.error?.detail ?? 'No pudimos actualizar la contraseña.');
        },
      });
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }
}
