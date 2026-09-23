import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { Group } from '../../../core/models/group.model';
import { FuelType } from '../../../core/models/vehicle.model';
import { GroupService } from '../../../core/services/group.service';
import { VehicleService } from '../../../core/services/vehicle.service';
import { BackButtonComponent } from '../../../shared/back-button/back-button.component';

@Component({
  selector: 'app-vehicle-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, BackButtonComponent],
  templateUrl: './vehicle-create.component.html',
  styleUrl: './vehicle-create.component.scss',
})
export class VehicleCreateComponent {
  private fb = inject(FormBuilder);
  private groupService = inject(GroupService);
  private vehicleService = inject(VehicleService);
  private router = inject(Router);

  groups = signal<Group[]>([]);
  loading = signal(false);
  loadingGroups = signal(true);
  errorMessage = signal<string | null>(null);

  fuelTypes: { value: FuelType; label: string }[] = [
    { value: 'nafta', label: 'Nafta' },
    { value: 'diesel', label: 'Diésel' },
    { value: 'gnc', label: 'GNC' },
    { value: 'electrico', label: 'Eléctrico' },
  ];

  form = this.fb.nonNullable.group({
    group: [null as number | null, Validators.required],
    name: ['', Validators.required],
    fuel_type: ['' as FuelType],
    current_km: [null as number | null, [Validators.required, Validators.min(0)]],
  });

  constructor() {
    this.groupService.list().subscribe({
      next: (groups) => {
        this.groups.set(groups);
        const activeGroupId = this.groupService.getActiveGroupId();
        if (groups.length === 1) {
          this.form.patchValue({ group: groups[0].id });
        } else if (activeGroupId !== null && groups.some((g) => g.id === activeGroupId)) {
          // venimos de un grupo activo -> ese es el default al crear
          this.form.patchValue({ group: activeGroupId });
        }
        this.loadingGroups.set(false);
      },
      error: () => {
        this.loadingGroups.set(false);
      },
    });
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const { group, name, fuel_type, current_km } = this.form.getRawValue();

    // en este punto el form ya pasó la validación (Validators.required),
    // así que group y current_km nunca son null -> el "!" es seguro acá
    this.vehicleService
      .create({
        group: group!,
        name,
        fuel_type: fuel_type || undefined,
        current_km: current_km!,
      })
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.router.navigate(['/vehiculos']);
        },
        error: (err) => {
          this.loading.set(false);
          this.errorMessage.set(
            err.error?.detail ?? 'No pudimos crear el vehículo. Revisá los datos.',
          );
        },
      });
  }
}
