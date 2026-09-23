import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { Group } from '../../../core/models/group.model';
import { GroupService } from '../../../core/services/group.service';
import { BackButtonComponent } from '../../../shared/back-button/back-button.component';

@Component({
  selector: 'app-group-join',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, BackButtonComponent],
  templateUrl: './group-join.component.html',
  styleUrl: './group-join.component.scss',
})
export class GroupJoinComponent {
  private fb = inject(FormBuilder);
  private groupService = inject(GroupService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  loading = signal(false);
  errorMessage = signal<string | null>(null);

  // si el usuario ya tenía grupos, el botón volver va al selector; si no, al onboarding
  private hasGroups = false;

  form = this.fb.nonNullable.group({
    invite_code: ['', Validators.required],
  });

  constructor() {
    // soporta entrar por un link tipo /grupos/unirse?code=A3F91B2C
    const codeFromLink = this.route.snapshot.queryParamMap.get('code');
    if (codeFromLink) {
      this.form.patchValue({ invite_code: codeFromLink.toUpperCase() });
    }

    this.groupService.list().subscribe({
      next: (groups) => {
        this.hasGroups = groups.length > 0;
      },
      error: () => {
        this.hasGroups = false;
      },
    });
  }

  back(): void {
    this.router.navigate([this.hasGroups ? '/grupos/selector' : '/grupos/nuevo']);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    this.groupService.join(this.form.getRawValue().invite_code).subscribe({
      next: (group: Group) => {
        // ya estamos en el grupo -> lo dejamos como activo y vamos a sus vehículos
        this.groupService.setActiveGroupId(group.id);
        this.loading.set(false);
        this.router.navigate(['/vehiculos']);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('Código inválido. Revisalo con quien te lo compartió.');
      },
    });
  }
}
