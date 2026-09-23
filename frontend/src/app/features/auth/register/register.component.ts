import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../core/services/auth.service';
import { BackButtonComponent } from '../../../shared/back-button/back-button.component';

function passwordsMatchValidator(): ValidatorFn {
  return (group: AbstractControl) => {
    const password = group.get('password')?.value;
    const confirmPassword = group.get('confirmPassword')?.value;
    return password === confirmPassword ? null : { passwordMismatch: true };
  };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, BackButtonComponent],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  loading = signal(false);
  errorMessage = signal<string | null>(null);
  showPassword = signal(false);
  showConfirmPassword = signal(false);

  form = this.fb.nonNullable.group(
    {
      name: ['', Validators.required],
      first_name: ['', Validators.required],
      last_name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatchValidator() },
  );

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const { name, first_name, last_name, email, password } = this.form.getRawValue();

    this.auth.register({ name, first_name, last_name, email, password }).subscribe({
      next: () => {
        // el registro no devuelve tokens -> logueamos directo para no
        // pedirle el password una segunda vez
        this.auth.login({ email, password }).subscribe({
          next: () => {
            this.auth.fetchMe().subscribe(() => {
              this.loading.set(false);
              this.router.navigate(['/grupos/selector']);
            });
          },
          error: () => {
            this.loading.set(false);
            this.router.navigate(['/login']);
          },
        });
      },
      error: (err) => {
        this.loading.set(false);

        const passwordErrors = err.error?.password;
        if (passwordErrors?.length) {
          this.errorMessage.set(passwordErrors.join(' '));
        } else {
          this.errorMessage.set(
            err.error?.email?.[0] ?? 'No pudimos crear la cuenta. Revisá los datos.',
          );
        }
      },
    });
  }
}
