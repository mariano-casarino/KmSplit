import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { Group } from '../../../core/models/group.model';
import { GroupService } from '../../../core/services/group.service';
import { BackButtonComponent } from '../../../shared/back-button/back-button.component';

@Component({
  selector: 'app-group-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, BackButtonComponent],
  templateUrl: './group-create.component.html',
  styleUrl: './group-create.component.scss',
})
export class GroupCreateComponent {
  private fb = inject(FormBuilder);
  private groupService = inject(GroupService);
  private router = inject(Router);

  loading = signal(false);
  errorMessage = signal<string | null>(null);
  createdGroup = signal<Group | null>(null);
  codeCopied = signal(false);

  // si el usuario ya tenía grupos, el botón volver va al selector; si no,
  // al onboarding
  private hasGroups = false;

  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
  });

  constructor() {
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

    this.groupService.create(this.form.getRawValue().name).subscribe({
      next: (group) => {
        this.loading.set(false);
        this.createdGroup.set(group);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('No pudimos crear el grupo. Probá de nuevo.');
      },
    });
  }

  copyInviteCode(): void {
    const code = this.createdGroup()?.invite_code;
    if (!code) return;
    navigator.clipboard?.writeText(code);
    this.codeCopied.set(true);
    setTimeout(() => this.codeCopied.set(false), 2000);
  }

  continue(): void {
    const group = this.createdGroup();
    if (group) {
      // el grupo recién creado queda como el activo
      this.groupService.setActiveGroupId(group.id);
    }
    this.router.navigate(['/vehiculos']);
  }
}
