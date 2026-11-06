import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { Group, GroupMembership, GroupRole } from '../../../core/models/group.model';
import { Settlement } from '../../../core/models/settlement.model';
import { Vehicle } from '../../../core/models/vehicle.model';
import { AuthService } from '../../../core/services/auth.service';
import { GroupService } from '../../../core/services/group.service';
import { VehicleService } from '../../../core/services/vehicle.service';
import { BottomNavComponent } from '../../../shared/bottom-nav/bottom-nav.component';
import { ArgNumberPipe } from '../../../shared/pipes/arg-number.pipe';
import { BackButtonComponent } from '../../../shared/back-button/back-button.component';
import { NotificationsBellComponent } from '../../../shared/notifications-bell/notifications-bell.component';
import { fileToCompressedDataUri } from '../../../shared/utils/image.util';
import { retryTransient } from '../../../shared/utils/retry-transient.util';

@Component({
  selector: 'app-vehicle-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    BottomNavComponent,
    ArgNumberPipe,
    BackButtonComponent,
    NotificationsBellComponent,
  ],
  templateUrl: './vehicle-home.component.html',
  styleUrl: './vehicle-home.component.scss',
})
export class VehicleHomeComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private vehicleService = inject(VehicleService);
  private groupService = inject(GroupService);
  private auth = inject(AuthService);

  vehicleId = Number(this.route.snapshot.paramMap.get('id'));

  /** Pantalla exacta desde la que se abre el perfil, para que el botón de
   *  atrás del perfil devuelva acá y no a la lista de vehículos. */
  profileBack = `/vehiculo/${this.vehicleId}`;

  vehicle = signal<Vehicle | null>(null);
  group = signal<Group | null>(null);
  settlements = signal<Settlement[]>([]);
  loading = signal(true);
  errorMessage = signal<string | null>(null);
  photoSaving = signal(false);
  photoMessage = signal<string | null>(null);
  currentUserId = signal(0);
  myRole = signal<GroupRole | null>(null);

  /** Saldo a pagar del usuario: suma de amount_owed no tildado en liquidaciones. */
  saldoAPagar = computed(() => {
    const uid = this.currentUserId();
    if (!uid) return 0;
    let total = 0;
    for (const s of this.settlements()) {
      const detail = s.details?.find((d) => d.user === uid);
      if (detail && !detail.paid) total += Number(detail.amount_owed) || 0;
    }
    return total;
  });

  ngOnInit(): void {
    this.loadVehicle();
  }

  private loadVehicle(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    // dashboard() trae vehicle + group + settlements en 1 request (y más);
    // fetchMe es resiliente: si falla, el inicio igual se muestra.
    forkJoin({
      user: this.auth.fetchMe().pipe(retryTransient(3), catchError(() => of(null))),
      dashboard: this.vehicleService.dashboard(this.vehicleId).pipe(retryTransient(3)),
    }).subscribe({
      next: ({ user, dashboard }) => {
        const { vehicle, group, settlements } = dashboard;
        if (user) this.currentUserId.set(user.id);
        this.vehicleService.setLastVehicleId(vehicle.id);
        this.groupService.setActiveGroupId(vehicle.group);
        this.vehicle.set(vehicle);
        this.group.set(group);
        this.settlements.set(settlements ?? []);
        const membership = user ? group.members.find((m) => m.user === user.id) : undefined;
        this.myRole.set(membership?.role ?? null);
        this.loading.set(false);
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

    fileToCompressedDataUri(file, 'vehiculo')
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
