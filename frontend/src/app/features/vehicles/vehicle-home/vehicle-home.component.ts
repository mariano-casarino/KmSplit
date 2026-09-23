import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { Group, GroupMembership, GroupRole } from '../../../core/models/group.model';
import { Vehicle } from '../../../core/models/vehicle.model';
import { AuthService } from '../../../core/services/auth.service';
import { GroupService } from '../../../core/services/group.service';
import { VehicleService } from '../../../core/services/vehicle.service';
import { BottomNavComponent } from '../../../shared/bottom-nav/bottom-nav.component';
import { ArgNumberPipe } from '../../../shared/pipes/arg-number.pipe';
import { BackButtonComponent } from '../../../shared/back-button/back-button.component';
import { fileToCompressedDataUri } from '../../../shared/utils/image.util';
import { retryTransient } from '../../../shared/utils/retry-transient.util';

@Component({
  selector: 'app-vehicle-home',
  standalone: true,
  imports: [CommonModule, RouterLink, BottomNavComponent, ArgNumberPipe, BackButtonComponent],
  templateUrl: './vehicle-home.component.html',
  styleUrl: './vehicle-home.component.scss',
})
export class VehicleHomeComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private vehicleService = inject(VehicleService);
  private groupService = inject(GroupService);
  private auth = inject(AuthService);

  vehicleId = Number(this.route.snapshot.paramMap.get('id'));

  vehicle = signal<Vehicle | null>(null);
  group = signal<Group | null>(null);
  loading = signal(true);
  errorMessage = signal<string | null>(null);
  photoSaving = signal(false);
  photoMessage = signal<string | null>(null);
  currentUserId = 0;
  myRole = signal<GroupRole | null>(null);

  ngOnInit(): void {
    this.loadVehicle();
  }

  private loadVehicle(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    // fetchMe y vehicle son independientes: corren en paralelo. fetchMe es
    // resiliente (si falla, el vehículo igual se muestra); vehicle.group
    // (depende del vehicle) se consulta después, ya cacheado.
    forkJoin({
      user: this.auth.fetchMe().pipe(retryTransient(3), catchError(() => of(null))),
      vehicle: this.vehicleService.get(this.vehicleId).pipe(retryTransient(3)),
    }).subscribe({
      next: ({ user, vehicle }) => {
        if (user) this.currentUserId = user.id;
        this.vehicleService.setLastVehicleId(vehicle.id);
        // el grupo del vehículo pasa a ser el "activo" para que el botón
        // volver (‹) te devuelva siempre a la lista de su grupo
        this.groupService.setActiveGroupId(vehicle.group);
        this.vehicle.set(vehicle);

        this.groupService.get(vehicle.group).subscribe({
          next: (group) => {
            this.group.set(group);
            const membership = group.members.find((m) => m.user === this.currentUserId);
            this.myRole.set(membership?.role ?? null);
            this.loading.set(false);
          },
          error: () => this.loading.set(false),
        });
      },
      error: () => this.failLoading(),
    });
  }

  // Si tras reintentar la vista del vehículo no carga (éxito el típico fallo
  // transitorio al reanudar la app tras inactividad), en lugar de dejar al
  // usuario en una pantalla muerta lo mandamos a la lista de vehículos, que es
  // donde manualmente termina por recarga. Ahí puede volver a entrar al auto.
  private failLoading(): void {
    this.loading.set(false);
    this.errorMessage.set('No pudimos cargar este vehículo. Tocá reintentar.');
  }

  retry(): void {
    this.loadVehicle();
  }

  get canManage(): boolean {
    return this.myRole() === 'owner' || this.myRole() === 'admin';
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    // resetemos el input para poder elegir la misma foto de nuevo
    input.value = '';

    this.photoSaving.set(true);
    this.photoMessage.set(null);
    this.errorMessage.set(null);

    fileToCompressedDataUri(file)
      .then((dataUri) => this.savePhoto(dataUri))
      .catch((err: Error) => {
        this.photoSaving.set(false);
        this.photoMessage.set(err.message);
      });
  }

  removePhoto(): void {
    const current = this.vehicle();
    if (!current) return;
    this.photoSaving.set(true);
    this.photoMessage.set(null);
    this.savePhoto('');
  }

  private savePhoto(photoUrl: string): void {
    const current = this.vehicle();
    if (!current) return;

    this.vehicleService.update(current.id, { photo_url: photoUrl }).subscribe({
      next: (updated) => {
        this.vehicle.set(updated);
        this.photoSaving.set(false);
        this.photoMessage.set(
          photoUrl ? 'Foto actualizada.' : 'Foto quitada.',
        );
      },
      error: (err) => {
        this.photoSaving.set(false);
        this.photoMessage.set(
          err.error?.photo_url?.[0] ?? 'No pudimos guardar la foto.',
        );
      },
    });
  }
}
