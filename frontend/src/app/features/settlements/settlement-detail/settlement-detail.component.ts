import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { Settlement, SettlementStatus } from '../../../core/models/settlement.model';
import { AuthService } from '../../../core/services/auth.service';
import { FuelLoadService } from '../../../core/services/fuel-load.service';
import { SettlementService } from '../../../core/services/settlement.service';
import { VehicleService } from '../../../core/services/vehicle.service';
import { BottomNavComponent } from '../../../shared/bottom-nav/bottom-nav.component';
import { ArgNumberPipe } from '../../../shared/pipes/arg-number.pipe';
import { BackButtonComponent } from '../../../shared/back-button/back-button.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-settlement-detail',
  standalone: true,
  imports: [CommonModule, BottomNavComponent, ArgNumberPipe, BackButtonComponent, ConfirmDialogComponent],
  templateUrl: './settlement-detail.component.html',
  styleUrl: './settlement-detail.component.scss',
})
export class SettlementDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private settlementService = inject(SettlementService);
  private fuelLoadService = inject(FuelLoadService);
  private vehicleService = inject(VehicleService);
  private auth = inject(AuthService);

  vehicleId = Number(this.route.snapshot.paramMap.get('id'));
  settlementId = Number(this.route.snapshot.paramMap.get('settlementId'));

  /** Desde dónde se abrió la liquidación: 'carga', 'resumen' o 'historial'. */
  from = this.route.snapshot.queryParamMap.get('from') ?? 'historial';

  /** Ruta de "volver" según el origen de la visita. */
  backRoute(): (string | number)[] {
    if (this.from === 'carga') return ['/vehiculo', this.vehicleId, 'carga'];
    if (this.from === 'resumen') return ['/vehiculo', this.vehicleId, 'resumen'];
    return ['/vehiculo', this.vehicleId, 'historial'];
  }

  settlement = signal<Settlement | null>(null);
  loading = signal(true);
  errorMessage = signal<string | null>(null);
  canManage = signal(false);
  updatingStatus = signal(false);
  deleting = signal(false);
  deleteDialog = signal(false);

  ngOnInit(): void {
    // dashboard() trae vehicle + group + todos los settlements (con detalles)
    // en 1 sola request; extraemos el que corresponde a esta URL. fetchMe es
    // resiliente: si falla, la liquidación igual se muestra (solo se ocultan
    // los botones de editar/eliminar).
    forkJoin({
      user: this.auth.fetchMe().pipe(catchError(() => of(null))),
      dashboard: this.vehicleService.dashboard(this.vehicleId),
    }).subscribe({
      next: ({ user, dashboard }) => {
        const { vehicle, group, settlements } = dashboard;
        const settlement = settlements.find((s) => s.id === this.settlementId);

        if (!settlement) {
          this.errorMessage.set('No pudimos cargar esta liquidación.');
          this.loading.set(false);
          return;
        }

        this.settlement.set(settlement);

        const membership = user
          ? group.members.find((m) => m.user === user.id)
          : undefined;
        // Editar/eliminar una liquidación solo aplica si es la última del
        // vehículo: si hay otra más reciente, el backend no la deja borrar.
        const isLastSettlement = !settlements.some((s) => s.id > settlement.id);
        this.canManage.set(
          (membership?.role === 'owner' || membership?.role === 'admin') &&
            isLastSettlement,
        );
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('No pudimos cargar esta liquidación.');
        this.loading.set(false);
      },
    });
  }

  toggleStatus(): void {
    const current = this.settlement();
    if (!current) return;

    const newStatus: SettlementStatus = current.status === 'pendiente' ? 'pagado' : 'pendiente';
    this.updatingStatus.set(true);

    this.settlementService.markStatus(current.id, newStatus).subscribe({
      next: (updated) => {
        this.settlement.set(updated);
        this.updatingStatus.set(false);
        // el estado sale en el dashboard cacheado (resumen/liquidaciones)
        this.vehicleService.invalidate(this.vehicleId);
      },
      error: () => {
        this.updatingStatus.set(false);
        this.errorMessage.set('No pudimos actualizar el estado.');
      },
    });
  }

  editLoad(): void {
    const settlement = this.settlement();
    if (!settlement) return;
    this.router.navigate(['/vehiculo', this.vehicleId, 'carga'], {
      queryParams: {
        edit: settlement.fuel_load,
        liquidacion: settlement.id,
        from: this.from,
      },
    });
  }

  confirmDelete(): void {
    const settlement = this.settlement();
    if (!settlement) return;
    this.deleteDialog.set(true);
  }

  /** Mensaje del diálogo (texto plano: el componente compartido no renderiza HTML). */
  confirmDeleteMessage(): string {
    const settlement = this.settlement();
    if (!settlement) return '';
    return `¿Seguro que querés eliminar la carga que originó esta liquidación del ${settlement.period_start_km} al ${settlement.period_end_km} km?`;
  }

  cancelDelete(): void {
    this.deleteDialog.set(false);
  }

  doDelete(): void {
    const settlement = this.settlement();
    if (!settlement) return;
    this.deleting.set(true);
    this.fuelLoadService.delete(settlement.fuel_load).subscribe({
      next: () => {
        this.deleting.set(false);
        // borramos una carga -> sus viajes/liquidaciones salen del dashboard
        this.vehicleService.invalidate(this.vehicleId);
        this.router.navigate(this.backRoute());
      },
      error: () => {
        this.deleting.set(false);
        this.deleteDialog.set(false);
        this.errorMessage.set(
          'No se pudo eliminar la carga. Quizás dejó de ser la última carga del vehículo.',
        );
      },
    });
  }
}
