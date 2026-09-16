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

type PeriodKey = 'semana' | 'mes' | '3meses';

interface RecentRecord {
  id: string;
  date: string;
  sortKey: number;
  type: 'trip' | 'fuel';
  userName: string;
  label: string;
  tripId?: number;
  settlementId?: number;
  clickable: boolean;
}

@Component({
  selector: 'app-summary',
  standalone: true,
  imports: [CommonModule, RouterLink, BottomNavComponent, ArgNumberPipe],
  templateUrl: './summary.component.html',
  styleUrl: './summary.component.scss',
})
export class SummaryComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehicleService = inject(VehicleService);
  private auth = inject(AuthService);

  vehicleId = Number(this.route.snapshot.paramMap.get('id'));

  vehicle = signal<Vehicle | null>(null);
  group = signal<Group | null>(null);
  trips = signal<Trip[]>([]);
  fuelLoads = signal<FuelLoad[]>([]);
  settlements = signal<Settlement[]>([]);
  fuelLoadToSettlement = new Map<number, number>();
  loading = signal(true);
  errorMessage = signal<string | null>(null);
  currentUserRole = signal<GroupRole | null>(null);

  selectedPeriod = signal<PeriodKey>('semana');

  private periodDays: Record<PeriodKey, number> = { semana: 7, mes: 30, '3meses': 90 };
  private colors = [
    'var(--blue-400)',
    'var(--green)',
    'var(--amber)',
    'var(--purple)',
    'var(--gray-700)',
    'var(--red-pink)',
    'var(--blue-500)',
  ];

  ngOnInit(): void {
    // dashboard() trae vehicle+group+trips+fuelLoads+settlements en 1 request;
    // fetchMe es resiliente: si falla, el resumen igual se muestra.
    forkJoin({
      user: this.auth.fetchMe().pipe(catchError(() => of(null))),
      dashboard: this.vehicleService.dashboard(this.vehicleId),
    }).subscribe({
      next: ({ user, dashboard }) => {
        const { vehicle, group, trips, fuel_loads, settlements } = dashboard;
        this.vehicle.set(vehicle);
        this.group.set(group);
        this.trips.set(trips);
        this.fuelLoads.set(fuel_loads);
        this.settlements.set(settlements);
        settlements.forEach((s) => this.fuelLoadToSettlement.set(s.fuel_load, s.id));

        const membership = user
          ? group.members.find((m) => m.user === user.id)
          : undefined;
        this.currentUserRole.set(membership?.role ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('No pudimos cargar el resumen.');
        this.loading.set(false);
      },
    });
  }

  // El backend ya devuelve los settlements ordenados por -created_at,
  // así que el primero de la lista es siempre el más reciente.
  get latestSettlement(): Settlement | null {
    return this.settlements()[0] ?? null;
  }

  /** Mismo umbral de "atrasado" que los baches del historial: la alerta
   *  pasa a rojo solo si la última liquidación sigue pendiente de pago hace
   *  más de 14 días. */
  get hasUnassignedUrgent(): boolean {
    const s = this.latestSettlement;
    return !!s && s.status === 'pendiente' && this.daysSince(s.created_at) > 14;
  }

  private daysSince(iso: string): number {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return 0;
    return (Date.now() - t) / 86_400_000;
  }

  /** Últimos registros con la misma forma y reglas de navegación que el
   *  historial: orden por km (el más reciente, más cerca del odómetro, va
   *  primero). */
  get recentRecords(): RecentRecord[] {
    const role = this.currentUserRole();
    const canEditAny = role === 'owner' || role === 'admin';

    const tripRecords: RecentRecord[] = this.trips().map((t) => ({
      id: `trip-${t.id}`,
      date: t.trip_date,
      sortKey: t.start_km,
      type: 'trip',
      userName: this.memberName(t.user),
      label: `${formatKm(t.start_km)} → ${formatKm(t.end_km)} km / ${formatKm(t.km_traveled)} km`,
      tripId: t.id,
      clickable: canEditAny,
    }));

    const fuelRecords: RecentRecord[] = this.fuelLoads().map((f) => {
      const settlementId = this.fuelLoadToSettlement.get(f.id);
      return {
        id: `fuel-${f.id}`,
        date: f.load_date,
        sortKey: f.odometer_km,
        type: 'fuel',
        userName: this.memberName(f.loaded_by),
        label: `$${formatMoney(f.amount)}`,
        settlementId,
        clickable: !!settlementId,
      };
    });

    return [...tripRecords, ...fuelRecords]
      .sort((a, b) => {
        if (a.sortKey !== b.sortKey) return b.sortKey - a.sortKey;
        return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      })
      .slice(0, 5);
  }

  /** Abre el viaje en edición o la liquidación, igual que en el historial. */
  onRecordClick(record: RecentRecord): void {
    if (!record.clickable) return;
    if (record.type === 'trip' && record.tripId !== undefined) {
      this.router.navigate(['/vehiculo', this.vehicleId, 'viaje'], {
        queryParams: { tripId: record.tripId, returnTo: 'resumen' },
      });
    } else if (record.type === 'fuel' && record.settlementId !== undefined) {
      this.router.navigate(['/vehiculo', this.vehicleId, 'liquidacion', record.settlementId]);
    }
  }

  get usageByMember() {
    const days = this.periodDays[this.selectedPeriod()];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const members = (this.group()?.members ?? []).filter((m) => m.is_active);
    const kmByUser = new Map<number, number>();

    for (const trip of this.trips()) {
      if (trip.trip_date >= cutoffStr) {
        kmByUser.set(trip.user, (kmByUser.get(trip.user) ?? 0) + trip.km_traveled);
      }
    }

    const total = Array.from(kmByUser.values()).reduce((sum, km) => sum + km, 0);

    return members.map((m, index) => {
      const km = kmByUser.get(m.user) ?? 0;
      return {
        userId: m.user,
        name: m.user_name,
        km,
        percentage: total > 0 ? Math.round((km / total) * 100) : 0,
        color: this.colors[index % this.colors.length],
      };
    });
  }

  memberName(userId: number): string {
    return this.group()?.members.find((m) => m.user === userId)?.user_name ?? 'Usuario';
  }

  barHeight(percentage: number): number {
    return Math.max(4, (percentage / 100) * 80);
  }
}
