import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { Settlement } from '../../../core/models/settlement.model';
import { FuelLoad } from '../../../core/models/fuel-load.model';
import { FuelLoadService } from '../../../core/services/fuel-load.service';
import { SettlementService } from '../../../core/services/settlement.service';
import { VehicleService } from '../../../core/services/vehicle.service';
import { formatKm } from '../../../core/utils/format-args';
import { BottomNavComponent } from '../../../shared/bottom-nav/bottom-nav.component';

@Component({
  selector: 'app-fuel-load-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, BottomNavComponent],
  templateUrl: './fuel-load-form.component.html',
  styleUrl: './fuel-load-form.component.scss',
})
export class FuelLoadFormComponent {
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fuelLoadService = inject(FuelLoadService);
  private settlementService = inject(SettlementService);
  private vehicleService = inject(VehicleService);

  vehicleId = Number(this.route.snapshot.paramMap.get('id'));
  /** Si estamos editando una carga existente, su id viene por ?edit=. */
  editId = signal<number | null>(null);
  /** Id de la liquidación de la que venimos al editar (?liquidacion=). */
  settlementId = signal<number | null>(null);
  /** Origen: 'carga', 'historial' u otro (?from=). */
  returnPath = signal('carga');
  editLoading = signal(false);

  loading = signal(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  saveSuccess = signal(false);

  readonly settlementPageSize = 5;
  settlements = signal<Settlement[]>([]);
  settlementsVisible = signal(3);
  settlementsLoading = signal(true);

  constructor() {
    this.loadSettlements();
    // el BehaviorSubject emite el valor actual apenas nos suscribimos, con lo
    // que `?edit=` inicial ya dispara la carga de la carga a editar.
    this.route.queryParamMap.subscribe(() => this.syncEditMode());
  }

  private syncEditMode(): void {
    const next = this.paramOrNull('edit');
    const prev = this.editId();
    if (prev === next) return;

    this.saveSuccess.set(false);
    this.errorMessage.set(null);
    this.editId.set(next);
    this.settlementId.set(this.paramOrNull('liquidacion'));
    this.returnPath.set(this.route.snapshot.queryParamMap.get('from') ?? 'carga');

    if (next == null) {
      this.editLoading.set(false);
      this.form.reset({ load_date: this.today(), odometer_km: null, amount: null, liters: null });
      this.form.markAsPristine();
      return;
    }

    this.editLoading.set(true);
    this.fuelLoadService.get(next).subscribe({
      next: (load) => {
        this.form.patchValue({
          load_date: load.load_date,
          odometer_km: load.odometer_km,
          amount: Number(load.amount),
          liters: load.liters != null ? Number(load.liters) : null,
        });
        this.editLoading.set(false);
      },
      error: () => {
        this.errorMessage.set('No pudimos cargar la carga para editar.');
        this.editLoading.set(false);
      },
    });
  }

  get isEdit(): boolean {
    return this.editId() != null;
  }

  /**
   * A dónde volver al cancelar o al guardar: si se entró desde una liquidación,
   * de vuelta a esa liquidación; si no, a la vista de carga.
   */
  private backUrl(): string {
    const settlementId = this.settlementId();
    if (settlementId != null) {
      return `/vehiculo/${this.vehicleId}/liquidacion/${settlementId}?from=${this.returnPath()}`;
    }
    return `/vehiculo/${this.vehicleId}/carga`;
  }

  /** Sale del modo edición volviendo a donde veníamos. */
  cancelEdit(): void {
    this.router.navigateByUrl(this.backUrl()).catch(() => {});
  }

  private paramOrNull(name: string): number | null {
    const raw = this.route.snapshot.queryParamMap.get(name);
    return raw ? Number(raw) : null;
  }

  private loadSettlements(): void {
    this.settlementsLoading.set(true);
    this.settlementService.listByVehicle(this.vehicleId).subscribe({
      next: (list) => {
        const sorted = list
          .slice()
          .sort((a, b) => b.id - a.id)
          .slice(0, 3 + this.settlementPageSize);
        this.settlements.set(sorted);
        this.settlementsVisible.set(3);
        this.settlementsLoading.set(false);
      },
      error: () => {
        this.settlementsLoading.set(false);
      },
    });
  }

  get visibleSettlements(): Settlement[] {
    return this.settlements().slice(0, this.settlementsVisible());
  }

  get hasMoreSettlements(): boolean {
    return this.settlementsVisible() < this.settlements().length;
  }

  loadMoreSettlements(): void {
    this.settlementsVisible.update((v) => v + this.settlementPageSize);
  }

  settlementLabel(s: Settlement): string {
    const date = s.load_date ? this.formatDate(s.load_date) : '';
    const who = s.loaded_by_name ?? '';
    return `${formatKm(s.period_start_km)} → ${formatKm(s.period_end_km)} km · ${who} · ${date} · $${s.total_amount}`;
  }

  private formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  }

  goToSettlement(id: number): void {
    this.router.navigate(['/vehiculo', this.vehicleId, 'liquidacion', id], {
      queryParams: { from: 'carga' },
    });
  }

  form = this.fb.nonNullable.group({
    load_date: [this.today(), Validators.required],
    odometer_km: [null as number | null, [Validators.required, Validators.min(0)]],
    amount: [null as number | null, [Validators.required, Validators.min(0)]],
    liters: [null as number | null],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { load_date, odometer_km, amount, liters } = this.form.getRawValue();
    const editId = this.editId();

    const request$ = editId
      ? this.fuelLoadService.update(editId, {
          load_date,
          odometer_km: odometer_km!,
          amount: amount!,
          liters: liters ?? null,
        })
      : this.fuelLoadService.create({
          vehicle: this.vehicleId,
          load_date,
          odometer_km: odometer_km!,
          amount: amount!,
          liters: liters ?? undefined,
        });

    request$.subscribe({
      next: () => {
        this.loading.set(false);
        // la carga cambió los km/balances -> el dashboard cacheado queda viejo
        this.vehicleService.invalidate(this.vehicleId);
        if (editId) {
          // animación de éxito (~1s) antes de volver a la vista de carga
          this.saveSuccess.set(true);
          setTimeout(() => {
            this.router.navigateByUrl(this.backUrl()).catch(() => {});
          }, 1000);
          return;
        }
        this.successMessage.set('Carga registrada ✅');
        this.form.reset({ load_date: this.today(), odometer_km: null, amount: null, liters: null });
        this.form.markAsPristine();
        this.loadSettlements();
        setTimeout(() => this.successMessage.set(null), 3000);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(
          err.error?.odometer_km?.[0] ?? 'No pudimos guardar la carga. Revisá los datos.',
        );
      },
    });
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
