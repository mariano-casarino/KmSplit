import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { FuelLoad } from '../../core/models/fuel-load.model';
import { Group, GroupRole } from '../../core/models/group.model';
import { Settlement } from '../../core/models/settlement.model';
import { Trip } from '../../core/models/trip.model';
import { Vehicle } from '../../core/models/vehicle.model';
import { AuthService } from '../../core/services/auth.service';
import { VehicleService } from '../../core/services/vehicle.service';
import { BottomNavComponent } from '../../shared/bottom-nav/bottom-nav.component';
import { ArgNumberPipe } from '../../shared/pipes/arg-number.pipe';
import { formatKm, formatMoney } from '../../core/utils/format-args';

type FilterKey = 'todos' | 'viajes' | 'cargas';

interface HistoryRecord {
  id: string;
  date: string;
  sortKey: number;
  type: 'trip' | 'fuel';
  userName: string;
  userId: number;
  label: string;
  tripId?: number;
  settlementId?: number;
  clickable: boolean;
}

interface KmGap {
  id: string;
  periodLabel: string;
  gapStartKm: number;
  gapEndKm: number;
  gapSize: number;
  before: string;
  after: string;
  /** Período viejo sin cerrar: líquido pendiente de pago o abierto hace +14 días. */
  urgent: boolean;
}

/** Umbral en días para considerar a un período "atrasado" (acento rojo). */
const STALE_PERIOD_DAYS = 14;

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule, RouterLink, BottomNavComponent, ArgNumberPipe],
  templateUrl: './history.component.html',
  styleUrl: './history.component.scss',
})
export class HistoryComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehicleService = inject(VehicleService);
  private auth = inject(AuthService);

  vehicleId = Number(this.route.snapshot.paramMap.get('id'));
  scope: 'week' | 'full' = (this.route.snapshot.data['scope'] as 'week' | 'full') ?? 'full';

  vehicle = signal<Vehicle | null>(null);
  group = signal<Group | null>(null);
  trips = signal<Trip[]>([]);
  fuelLoads = signal<FuelLoad[]>([]);
  settlements = signal<Settlement[]>([]);
  fuelLoadToSettlement = signal<Map<number, number>>(new Map());
  loading = signal(true);
  errorMessage = signal<string | null>(null);
  filter = signal<FilterKey>('todos');
  /** Muestra los 3 primeros huecos; al pulsar "ver más" se despliegan todos. */
  showAllGaps = signal(false);

  private currentUserId = 0;
  private currentUserRole = signal<GroupRole | null>(null);

  ngOnInit(): void {
    // dashboard() trae vehicle+group+trips+fuelLoads+settlements en 1 request.
    // fetchMe es resiliente: si falla, el historial igual se muestra.
    forkJoin({
      user: this.auth.fetchMe().pipe(catchError(() => of(null))),
      dashboard: this.vehicleService.dashboard(this.vehicleId),
    }).subscribe({
      next: ({ user, dashboard }) => {
        if (user) this.currentUserId = user.id;
        const { vehicle, group, trips, fuel_loads, settlements } = dashboard;
        this.vehicle.set(vehicle);
        this.group.set(group);
        this.trips.set(trips);
        this.fuelLoads.set(fuel_loads);
        this.settlements.set(settlements);

        const map = new Map<number, number>();
        settlements.forEach((s) => map.set(s.fuel_load, s.id));
        this.fuelLoadToSettlement.set(map);

        const membership = user
          ? group.members.find((m) => m.user === user.id)
          : undefined;
        this.currentUserRole.set(membership?.role ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('No pudimos cargar el historial.');
        this.loading.set(false);
      },
    });
  }

  get title(): string {
    return this.scope === 'week' ? 'Últimos 7 días' : 'Historial completo';
  }

  get records(): HistoryRecord[] {
    const cutoffStr = this.scope === 'week' ? this.sevenDaysAgo() : null;
    const canEditAny = this.currentUserRole() === 'owner' || this.currentUserRole() === 'admin';

    const tripRecords: HistoryRecord[] = this.trips()
      .filter((t) => !cutoffStr || t.trip_date >= cutoffStr)
      .map((t) => ({
        id: `trip-${t.id}`,
        date: t.trip_date,
        sortKey: t.start_km,
        type: 'trip' as const,
        userName: this.memberName(t.user),
        userId: t.user,
        label: `${formatKm(t.start_km)} → ${formatKm(t.end_km)} km / ${formatKm(t.km_traveled)} km`,
        tripId: t.id,
        clickable: canEditAny || t.user === this.currentUserId,
      }));

    const fuelRecords: HistoryRecord[] = this.fuelLoads()
      .filter((f) => !cutoffStr || f.load_date >= cutoffStr)
      .map((f) => {
        const settlementId = this.fuelLoadToSettlement().get(f.id);
        return {
          id: `fuel-${f.id}`,
          date: f.load_date,
          sortKey: f.odometer_km,
          type: 'fuel' as const,
          userName: this.memberName(f.loaded_by),
        userId: f.loaded_by,
        label: `$${formatMoney(f.amount)}`,
          settlementId,
          clickable: !!settlementId,
        };
      });

    // Orden cronológico por km (descendente: primero el km más alto/último):
    // viajes por start_km, cargas por odometer_km. La fecha queda solo como
    // dato; no define el orden.
    const all = [...tripRecords, ...fuelRecords].sort((a, b) => {
      if (a.sortKey !== b.sortKey) return b.sortKey - a.sortKey;
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });

    if (this.filter() === 'viajes') return all.filter((r) => r.type === 'trip');
    if (this.filter() === 'cargas') return all.filter((r) => r.type === 'fuel');
    return all;
  }

  /**
   * Recorre CADA período (cada liquidación cerrada + el período abierto
   * actual) y detecta los tramos de km que quedaron sin ningún viaje
   * registrado -- independiente del filtro de semana/completo, porque un
   * hueco puede estar en cualquier fecha y no queremos que se escape.
   */
  get kmGaps(): KmGap[] {
    const vehicle = this.vehicle();
    if (!vehicle) return [];

    interface PeriodDef {
      label: string;
      start: number;
      end: number | null;
      settlementId: number | null;
      urgent: boolean;
    }

    const lastLoad = this.lastFuelLoadDate();

    const periods: PeriodDef[] = this.settlements()
      .slice()
      .sort((a, b) => a.period_start_km - b.period_start_km)
      .map((s) => ({
        label: `Liquidación del ${this.formatDate(s.created_at)}`,
        start: s.period_start_km,
        end: s.period_end_km,
        settlementId: s.id,
        urgent: this.isUrgentPeriod(s.id, lastLoad),
      }));

    periods.push({
      label: 'Período actual (todavía sin cerrar)',
      start: vehicle.current_km,
      end: null,
      settlementId: null,
      urgent: this.isUrgentPeriod(null, lastLoad),
    });

    const gaps: KmGap[] = [];

    for (const period of periods) {
      // Mismo criterio que el backend (recalculate_settlement): los viajes se
      // cuentan por SOLAPAMIENTO de rango de km (start_km < period_end AND
      // end_km > period_start), NO por el FK settlement. El FK solo se asigna
      // a los viajes creados DESPUÉS de haber liquidado el período; los que
      // estaban en el período abierto al momento de la carga quedan con
      // settlement=null y, si filtrásemos por FK, reportarían huecos falsos.
      const periodTrips = this.trips()
        .filter((t) =>
          period.end === null
            ? t.end_km > period.start
            : t.start_km < period.end && t.end_km > period.start,
        )
        .sort((a, b) => a.start_km - b.start_km);

      let cursor = period.start;
      let lastTripName: string | null = null;

      for (const trip of periodTrips) {
        // Recortamos el viaje al rango de ESTE período (igual que el backend
        // prorratea con clip_start/clip_end): un viaje que cruza el límite
        // aporta acá solo la parte que cae dentro de la liquidación.
        const clipEnd = period.end === null ? trip.end_km : Math.min(trip.end_km, period.end);
        const clipStart = Math.max(trip.start_km, period.start);

        if (clipStart > cursor) {
          gaps.push({
            id: `gap-${period.settlementId ?? 'open'}-${cursor}`,
            periodLabel: period.label,
            gapStartKm: cursor,
            gapEndKm: clipStart,
            gapSize: clipStart - cursor,
            before: lastTripName ?? 'el inicio del período',
            after: this.memberName(trip.user),
            urgent: period.urgent,
          });
        }
        cursor = Math.max(cursor, clipEnd);
        lastTripName = this.memberName(trip.user);
      }

      if (period.end !== null && cursor < period.end) {
        gaps.push({
          id: `gap-${period.settlementId ?? 'open'}-final`,
          periodLabel: period.label,
          gapStartKm: cursor,
          gapEndKm: period.end,
          gapSize: period.end - cursor,
          before: lastTripName ?? 'el inicio del período',
          after: 'el cierre de esa liquidación',
          urgent: period.urgent,
        });
      }
    }

    // Primero el bache más reciente (el de mayor kilometraje, más cerca del
    // odómetro actual): es el que el conductor ve hoy y el que queda visible
    // por defecto.
    return gaps.sort((a, b) => b.gapStartKm - a.gapStartKm);
  }

  /** Total de km que quedaron sin registrar (suma de todos los huecos). */
  get gapsTotalKm(): number {
    return this.kmGaps.reduce((acc, g) => acc + g.gapSize, 0);
  }

  /** Cantidad de períodos distintos con huecos, para el contador del header. */
  get gapsPeriodCount(): number {
    return new Set(this.kmGaps.map((g) => g.periodLabel)).size;
  }

  /** "X km sin registrar" o "X km sin registrar en N períodos" según cuántos. */
  get gapsSummary(): string {
    const base = `${formatKm(this.gapsTotalKm)} km sin registrar`;
    return this.gapsPeriodCount > 1 ? `${base} en ${this.gapsPeriodCount} períodos` : base;
  }

  /** Huecos que siguen ocultos detrás del "Ver más". */
  get remainingGaps(): number {
    return this.kmGaps.length - this.visibleGaps.length;
  }

  /** El hueco visible por defecto: uno solo, el más urgente. "Ver más"
   *  despliega la lista completa en el mismo lugar, sin navegar. */
  get visibleGaps(): KmGap[] {
    return this.showAllGaps() ? this.kmGaps : this.kmGaps.slice(0, 1);
  }

  /** Hay huecos ocultos tras el "ver más"? */
  get hasMoreGaps(): boolean {
    return this.kmGaps.length > 1;
  }

  toggleAllGaps(): void {
    this.showAllGaps.update((v) => !v);
  }

  /** Abre el form de viaje con el km inicial del hueco ya prefijado
   *  (?kmInicio=). Al guardar, vuelve al mismo histórico (returnTo). */
  onGapClick(gap: KmGap): void {
    const returnTo = this.scope === 'week' ? 'week' : 'full';
    this.router.navigate(['/vehiculo', this.vehicleId, 'viaje'], {
      queryParams: { returnTo, kmInicio: gap.gapStartKm },
    });
  }

  memberName(userId: number): string {
    return this.group()?.members.find((m) => m.user === userId)?.user_name ?? 'Usuario';
  }

  onRecordClick(record: HistoryRecord): void {
    if (!record.clickable) return;

    const returnTo = this.scope === 'week' ? 'week' : 'full';

    if (record.type === 'trip' && record.tripId) {
      this.router.navigate(['/vehiculo', this.vehicleId, 'viaje'], {
        queryParams: { tripId: record.tripId, returnTo },
      });
    } else if (record.type === 'fuel' && record.settlementId) {
      this.router.navigate(['/vehiculo', this.vehicleId, 'liquidacion', record.settlementId]);
    }
  }

  private sevenDaysAgo(): string {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }

  /** Días transcurridos (float) desde una fecha ISO hasta hoy. */
  private daysSince(iso: string): number {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return 0;
    return (Date.now() - t) / 86_400_000;
  }

  /** La fecha de la última carga de nafta: marca el nacimiento del período abierto. */
  private lastFuelLoadDate(): string | null {
    const dates = this.fuelLoads().map((f) => f.load_date).sort();
    return dates[dates.length - 1] ?? null;
  }

  /** Un período está "atrasado" cuando pasa el umbral sin cerrarse:
   *  el abierto lleva +STALE_PERIOD_DAYS desde la última carga, o una
   *  liquidación cerrada sigue pendiente de pago hace +STALE_PERIOD_DAYS. */
  private isUrgentPeriod(settlementId: number | null, lastLoadDate: string | null): boolean {
    if (settlementId === null) {
      return lastLoadDate !== null && this.daysSince(lastLoadDate) > STALE_PERIOD_DAYS;
    }
    const s = this.settlements().find((x) => x.id === settlementId);
    return !!s && s.status === 'pendiente' && this.daysSince(s.created_at) > STALE_PERIOD_DAYS;
  }

  private formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  }
}
