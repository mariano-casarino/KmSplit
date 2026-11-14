import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { FuelLoad } from '../../../core/models/fuel-load.model';
import { GroupRole } from '../../../core/models/group.model';
import { Settlement, SettlementDetail } from '../../../core/models/settlement.model';
import { AuthService } from '../../../core/services/auth.service';
import { FuelLoadService } from '../../../core/services/fuel-load.service';
import { SettlementService } from '../../../core/services/settlement.service';
import { VehicleService } from '../../../core/services/vehicle.service';
import { formatKm, formatMoney } from '../../../core/utils/format-args';
import { ArgNumberPipe } from '../../../shared/pipes/arg-number.pipe';
import { BackButtonComponent } from '../../../shared/back-button/back-button.component';
import { BottomNavComponent } from '../../../shared/bottom-nav/bottom-nav.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { NotificationsBellComponent } from '../../../shared/notifications-bell/notifications-bell.component';

/** Marca en el dispositivo que la descripción larga de Cargas ya se mostró. */
const DESC_SEEN_KEY = 'kmsplit.pagos.descSeen';

@Component({
  selector: 'app-pagos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    ArgNumberPipe,
    BackButtonComponent,
    BottomNavComponent,
    ConfirmDialogComponent,
    NotificationsBellComponent,
  ],
  templateUrl: './pagos.component.html',
  styleUrl: './pagos.component.scss',
})
export class PagosComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehicleService = inject(VehicleService);
  private settlementService = inject(SettlementService);
  private fuelLoadService = inject(FuelLoadService);
  private auth = inject(AuthService);

  vehicleId = Number(this.route.snapshot.paramMap.get('id'));
  /** Desde dónde se abrió Pagos: 'inicio' o 'resumen' (default). */
  from = this.route.snapshot.queryParamMap.get('from') ?? 'resumen';
  profileBack = `/vehiculo/${this.vehicleId}/resumen/pagos${this.from === 'inicio' ? '?from=inicio' : '?from=resumen'}`;

  loading = signal(true);
  /** Primera visita: descripción larga. Visitas siguientes: texto corto. */
  showFullDesc = signal(!this.readDescSeen());

  /** Ruta de "volver" según el origen de la visita. */
  backRoute(): (string | number)[] {
    if (this.from === 'inicio') return ['/vehiculo', this.vehicleId];
    return ['/vehiculo', this.vehicleId, 'resumen'];
  }
  errorMessage = signal<string | null>(null);
  settlements = signal<Settlement[]>([]);
  fuelLoadsById = signal<Map<number, FuelLoad>>(new Map());
  currentUserId = signal<number | null>(null);
  /** Rol del usuario en el grupo del vehículo (para editar/eliminar cargas). */
  currentUserRole = signal<GroupRole | null>(null);
  markingPaidId = signal<number | null>(null);
  deleting = signal(false);
  deleteDialog = signal(false);
  /** Liquidación cuya carga se está por eliminar. */
  pendingDelete = signal<Settlement | null>(null);
  /** Error de una acción puntual (borrar): no reemplaza el listado. */
  actionError = signal<string | null>(null);
  /** IDs de liquidaciones expandidas. La primera (última) arranca abierta. */
  expandedIds = signal<Set<number>>(new Set());

  /** Saldo a pagar del usuario: suma de amount_owed en períodos no tildados. */
  saldoAPagar = computed(() => {
    const uid = this.currentUserId();
    if (uid == null) return 0;
    let total = 0;
    for (const s of this.settlements()) {
      const detail = s.details?.find((d) => d.user === uid);
      if (detail && !detail.paid) {
        total += Number(detail.amount_owed) || 0;
      }
    }
    return total;
  });

  ngOnInit(): void {
    this.markDescSeen();

    forkJoin({
      user: this.auth.fetchMe().pipe(catchError(() => of(null))),
      dashboard: this.vehicleService.dashboard(this.vehicleId),
    }).subscribe({
      next: ({ user, dashboard }) => {
        if (user) {
          this.currentUserId.set(user.id);
          const membership = dashboard.group?.members.find((m) => m.user === user.id);
          this.currentUserRole.set(membership?.role ?? null);
        }
        const settlements = dashboard.settlements ?? [];
        const fuelLoads: FuelLoad[] = dashboard.fuel_loads ?? [];
        this.fuelLoadsById.set(new Map(fuelLoads.map((f) => [f.id, f])));
        this.settlements.set(settlements);
        if (settlements.length > 0) {
          this.expandedIds.set(new Set([settlements[0].id]));
        }
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('No pudimos cargar las liquidaciones.');
        this.loading.set(false);
      },
    });
  }

  isExpanded(id: number): boolean {
    return this.expandedIds().has(id);
  }

  toggle(id: number): void {
    this.expandedIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  collapse(id: number): void {
    this.expandedIds.update((set) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    });
  }

  fuelLoadFor(s: Settlement): FuelLoad | null {
    return this.fuelLoadsById().get(s.fuel_load) ?? null;
  }

  periodKm(s: Settlement): number {
    return Math.max(0, s.period_end_km - s.period_start_km);
  }

  pricePerLiter(s: Settlement): number | null {
    const liters = Number(this.fuelLoadFor(s)?.liters ?? 0);
    if (liters <= 0) return null;
    return Number(s.total_amount) / liters;
  }

  kmPerLiter(s: Settlement): number | null {
    const liters = Number(this.fuelLoadFor(s)?.liters ?? 0);
    if (liters <= 0) return null;
    const km = this.periodKm(s);
    if (km <= 0) return null;
    return km / liters;
  }

  sortedDetails(s: Settlement): SettlementDetail[] {
    return [...(s.details ?? [])].sort((a, b) => Number(b.amount_owed) - Number(a.amount_owed));
  }

  unpaidNames(s: Settlement): string[] {
    return [...(s.details ?? [])]
      .filter((d) => Number(d.amount_owed) > 0 && !d.paid)
      .sort((a, b) => Number(b.amount_owed) - Number(a.amount_owed))
      .map((d) => d.user_name);
  }

  canMarkPaid(s: Settlement): boolean {
    const uid = this.currentUserId();
    return uid != null && s.loaded_by === uid;
  }

  /** Sólo la última liquidación se puede editar/eliminar, y sólo owner/admin. */
  isLastSettlement(s: Settlement): boolean {
    return !this.settlements().some((x) => x.id > s.id);
  }

  canManage(s: Settlement): boolean {
    const role = this.currentUserRole();
    return (role === 'owner' || role === 'admin') && this.isLastSettlement(s);
  }

  editLoad(s: Settlement): void {
    if (!this.canManage(s)) return;
    this.actionError.set(null);
    // `from=pagos` hace que el form de carga vuelva acá al guardar o cancelar.
    this.router.navigate(['/vehiculo', this.vehicleId, 'carga'], {
      queryParams: {
        edit: s.fuel_load,
        liquidacion: s.id,
        from: 'pagos',
        pagosFrom: this.from,
      },
    });
  }

  confirmDelete(s: Settlement): void {
    if (!this.canManage(s)) return;
    this.actionError.set(null);
    this.pendingDelete.set(s);
    this.deleteDialog.set(true);
  }

  /** Mensaje del diálogo (texto plano: el componente compartido no renderiza HTML). */
  confirmDeleteMessage(): string {
    const s = this.pendingDelete();
    if (!s) return '';
    return `¿Seguro que querés eliminar la carga que originó esta liquidación del ${s.period_start_km} al ${s.period_end_km} km?`;
  }

  cancelDelete(): void {
    this.deleteDialog.set(false);
    this.pendingDelete.set(null);
  }

  doDelete(): void {
    const s = this.pendingDelete();
    if (!s) return;
    this.deleting.set(true);
    this.actionError.set(null);
    this.fuelLoadService.delete(s.fuel_load).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteDialog.set(false);
        this.pendingDelete.set(null);
        // Quitamos la tarjeta sin salir de Cargas; el resto de las
        // liquidaciones no cambia (sólo se puede borrar la última).
        this.settlements.update((list) => list.filter((x) => x.id !== s.id));
        this.fuelLoadsById.update((map) => {
          const next = new Map(map);
          next.delete(s.fuel_load);
          return next;
        });
        this.expandedIds.update((set) => {
          const next = new Set(set);
          next.delete(s.id);
          return next;
        });
        this.vehicleService.invalidate(this.vehicleId);
      },
      error: () => {
        this.deleting.set(false);
        this.deleteDialog.set(false);
        this.pendingDelete.set(null);
        this.actionError.set(
          'No se pudo eliminar la carga. Quizás dejó de ser la última carga del vehículo.',
        );
      },
    });
  }

  /** Info básica igual que en la parte de liquidaciones dentro de carga. */
  settlementLabel(s: Settlement): string {
    const date = s.load_date ? this.formatDate(s.load_date) : '';
    const who = s.loaded_by_name ?? '';
    return `${date} · ${who} · $${formatMoney(s.total_amount)} · ${formatKm(s.period_end_km)} km`;
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  isSettlementPaid(s: Settlement): boolean {
    if (!s.details || s.details.length === 0) return s.status === 'pagado';
    return s.details.every((d) => Number(d.amount_owed) <= 0 || !!d.paid);
  }

  markDetailPaid(s: Settlement, detailId: number, paid: boolean): void {
    if (!this.canMarkPaid(s)) return;
    const detail = s.details?.find((d) => d.id === detailId);
    if (detail && Number(detail.amount_owed) <= 0) return;
    this.markingPaidId.set(detailId);
    this.settlementService.markDetailPaid(s.id, detailId, paid).subscribe({
      next: (updated) => {
        this.settlements.update((list) => list.map((x) => (x.id === updated.id ? updated : x)));
        this.markingPaidId.set(null);
        this.vehicleService.invalidate(this.vehicleId);
      },
      error: () => {
        this.markingPaidId.set(null);
        this.errorMessage.set('No pudimos marcar el pago.');
      },
    });
  }

  /** localStorage puede fallar en modo privado o con permisos bloqueados:
   *  en ese caso cae siempre en la descripción larga. */
  private readDescSeen(): boolean {
    try {
      return localStorage.getItem(DESC_SEEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  private markDescSeen(): void {
    try {
      localStorage.setItem(DESC_SEEN_KEY, '1');
    } catch {
      // sin storage: la próxima visita vuelve a mostrar la descripción larga
    }
  }
}
