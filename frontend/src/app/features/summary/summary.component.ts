import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
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
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { NotificationsBellComponent } from '../../shared/notifications-bell/notifications-bell.component';
import { ArgNumberPipe } from '../../shared/pipes/arg-number.pipe';
import { BackButtonComponent } from '../../shared/back-button/back-button.component';
import { avatarColor } from '../../shared/avatar/avatar.util';
import { formatKm, formatMoney } from '../../core/utils/format-args';
import {
  createFlashHighlight,
  idsWithUnregisteredGap,
  parseHighlightRequest,
  recordKey,
  recordViewSegments,
  recordViewToOpen,
  resolveHighlightKey,
} from '../../core/utils/records';

type PeriodKey = 'semana' | 'mes' | '3meses';

/** Registros que se listan en "Últimos registros" del resumen. */
const RECENT_RECORDS_LIMIT = 5;

interface RecentRecord {
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

@Component({
  selector: 'app-summary',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ArgNumberPipe,
    BackButtonComponent,
    BottomNavComponent,
    AvatarComponent,
    NotificationsBellComponent,
  ],
  templateUrl: './summary.component.html',
  styleUrl: './summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehicleService = inject(VehicleService);
  private auth = inject(AuthService);

  vehicleId = Number(this.route.snapshot.paramMap.get('id'));

  /** Pantalla exacta desde la que se abre el perfil, para que su botón de
   *  atrás devuelva al resumen y no a la lista de vehículos. */
  profileBack = `/vehiculo/${this.vehicleId}/resumen`;

  vehicle = signal<Vehicle | null>(null);
  group = signal<Group | null>(null);
  trips = signal<Trip[]>([]);
  fuelLoads = signal<FuelLoad[]>([]);
  settlements = signal<Settlement[]>([]);
  fuelLoadToSettlement = signal<Map<number, number>>(new Map());
  loading = signal(true);
  errorMessage = signal<string | null>(null);
  currentUserRole = signal<GroupRole | null>(null);

  selectedPeriod = signal<PeriodKey>('semana');

  /** Resaltado temporal del registro al que se llegó desde una notificación
   *  (?highlight=trip-12): se enciende y se apaga solo. Al apagarse saca el
   *  ?highlight de la URL, para que tocar dos veces la misma notificación
   *  vuelva a encenderlo. */
  private readonly flashHighlight = createFlashHighlight(() => this.dropHighlightParam());
  readonly highlightedKey = this.flashHighlight.highlightedKey;
  private highlight: string | null = this.route.snapshot.queryParamMap.get('highlight');

  /** Ids de los registros cuyo separador inferior tiene km sin registrar:
   *  esa línea de la lista se pinta de naranja. */
  readonly gapAfterIds = signal<Set<string>>(new Set());

  private currentUserId = signal(0);
  private periodDays: Record<PeriodKey, number> = { semana: 7, mes: 30, '3meses': 90 };

  /** Índice user_id -> nombre del grupo: memberName() se llama una vez por
   *  registro en cada reconstrucción, y con `find()` lineal eso es
   *  O(registros × miembros). */
  private readonly memberNames = computed(() => {
    const mapa = new Map<number, string>();
    for (const m of this.group()?.members ?? []) {
      mapa.set(m.user, m.user_name);
    }
    return mapa;
  });

  ngOnInit(): void {
    // Si ya estamos en el resumen y se toca otra notificación, Angular
    // reutiliza esta misma instancia (misma ruta, distinto query param): hay
    // que volver a resolver el resaltado en cada cambio de ?highlight, si no
    // no se ve nada.
    this.route.queryParamMap.subscribe((params) => {
      this.highlight = params.get('highlight');
      if (!this.loading()) this.resolveHighlight();
    });

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
        this.fuelLoadToSettlement.set(
          new Map(settlements.map((s) => [s.fuel_load, s.id])),
        );

        if (user) this.currentUserId.set(user.id);
        const membership = user
          ? group.members.find((m) => m.user === user.id)
          : undefined;
        this.currentUserRole.set(membership?.role ?? null);
        this.computeGapAfterIds();
        this.loading.set(false);
        this.resolveHighlight();
      },
      error: () => {
        this.errorMessage.set('No pudimos cargar el resumen.');
        this.loading.set(false);
      },
    });
  }

  ngOnDestroy(): void {
    this.flashHighlight.clear();
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
   *  primero).
   *
   *  `computed` y no getter: el template lo pedía 2 veces por pasada de change
   *  detection (el `@if` de vacío y el `@for`) y cada vez armaba un map+sort de
   *  todos los viajes y todas las cargas. */
  readonly recentRecords = computed<RecentRecord[]>(() => {
    const role = this.currentUserRole();
    const canEditAny = role === 'owner' || role === 'admin';
    const currentUserId = this.currentUserId();
    const memberName = (userId: number) => this.memberNames().get(userId) ?? 'Usuario';

    const tripRecords: RecentRecord[] = this.trips().map((t) => ({
      id: recordKey('trip', t.id),
      date: t.trip_date,
      sortKey: t.start_km,
      type: 'trip' as const,
      userName: memberName(t.user),
      userId: t.user,
      label: `${formatKm(t.start_km)} → ${formatKm(t.end_km)} km / ${formatKm(t.km_traveled)} km`,
      tripId: t.id,
      // un miembro puede editar sus propios viajes (igual que en el historial),
      // aunque no pueda tocar los de los demás
      clickable: canEditAny || t.user === currentUserId,
    }));

    const fuelLoadToSettlement = this.fuelLoadToSettlement();
    const fuelRecords: RecentRecord[] = this.fuelLoads().map((f) => {
      const settlementId = fuelLoadToSettlement.get(f.id);
      return {
        id: recordKey('fuel', f.id),
        date: f.load_date,
        sortKey: f.odometer_km,
        type: 'fuel' as const,
        userName: memberName(f.loaded_by),
        userId: f.loaded_by,
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
      .slice(0, RECENT_RECORDS_LIMIT);
  });

  /**
   * Al llegar desde una notificación (?highlight=trip-12) se resalta ese
   * registro. Si no está entre los últimos del resumen se baja a "últimos 7
   * días"; si tampoco aparece ahí, ese componente lo baja al historial
   * completo. Así el usuario siempre aterriza viendo el registro.
   */
  private resolveHighlight(): void {
    const request = parseHighlightRequest(this.highlight);
    if (!request) {
      this.flashHighlight.clear();
      return;
    }

    const key = resolveHighlightKey(request, this.recentRecords());
    if (key) {
      this.flashHighlight.flash(key);
      this.scrollToRecord(key);
      return;
    }

    this.router.navigate(
      recordViewSegments(this.vehicleId, recordViewToOpen('resumen', false)),
      { queryParams: { highlight: this.highlight } },
    );
  }

  private scrollToRecord(key: string): void {
    // un tick después de pintar la fila, para que el DOM ya la tenga
    setTimeout(() => {
      document
        .getElementById(`record-${key}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  /** Saca el ?highlight de la URL (sin pilinga) cuando el resalte ya se
   *  apagó. Así, si se toca otra vez la misma notificación, el param cambia y
   *  el resalte se repite. */
  private dropHighlightParam(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { highlight: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Marca qué separadores de la lista tienen km sin registrar en el medio. */
  private computeGapAfterIds(): void {
    this.gapAfterIds.set(
      idsWithUnregisteredGap([
        ...this.trips().map((t) => ({
          id: recordKey('trip', t.id),
          minKm: t.start_km,
          maxKm: t.end_km,
        })),
        ...this.fuelLoads().map((f) => ({
          id: recordKey('fuel', f.id),
          minKm: f.odometer_km,
          maxKm: f.odometer_km,
        })),
      ]),
    );
  }

  /** Abre el viaje en edición o la liquidación, igual que en el historial. */
  onRecordClick(record: RecentRecord): void {
    if (!record.clickable) return;
    if (record.type === 'trip' && record.tripId !== undefined) {
      this.router.navigate(['/vehiculo', this.vehicleId, 'viaje'], {
        queryParams: { tripId: record.tripId, returnTo: 'resumen' },
      });
    } else if (record.type === 'fuel' && record.settlementId !== undefined) {
      this.router.navigate(['/vehiculo', this.vehicleId, 'liquidacion', record.settlementId], {
        queryParams: { from: 'resumen' },
      });
    }
  }

  /** Km por integrante en el período elegido (semana / mes / 3 meses).
   *
   *  `computed` y no getter: el template lo pedía 3 veces por pasada de change
   *  detection y cada llamada recorría TODOS los viajes y armaba un Map. */
  readonly usageByMember = computed(() => {
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

    return members.map((m) => {
      const km = kmByUser.get(m.user) ?? 0;
      return {
        userId: m.user,
        name: m.user_name,
        km,
        percentage: total > 0 ? Math.round((km / total) * 100) : 0,
        // mismo color que el avatar del integrante (estable por id de usuario)
        color: avatarColor(String(m.user)),
      };
    });
  });

  memberName(userId: number): string {
    return this.memberNames().get(userId) ?? 'Usuario';
  }

  barHeight(percentage: number): number {
    return Math.max(4, (percentage / 100) * 80);
  }
}
