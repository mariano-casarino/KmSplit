import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { Trip } from '../../../core/models/trip.model';
import { AuthService } from '../../../core/services/auth.service';
import { TripService } from '../../../core/services/trip.service';
import { VehicleService } from '../../../core/services/vehicle.service';
import { BottomNavComponent } from '../../../shared/bottom-nav/bottom-nav.component';
import { ArgNumberPipe } from '../../../shared/pipes/arg-number.pipe';

/**
 * Generaliza el atajo de "últimos N dígitos" a 1, 2 o 3 dígitos. La cantidad
 * de dígitos que el usuario tipeó define el "módulo" contra el que se
 * resuelve el cruce de decena/centena/millar.
 */
function calcularKmFinal(kmReferencia: number, digitos: string): number {
  const cantidadDigitos = digitos.length;
  const modulo = Math.pow(10, cantidadDigitos);
  const base = Math.floor(kmReferencia / modulo) * modulo;
  let candidato = base + parseInt(digitos, 10);
  if (candidato <= kmReferencia) {
    candidato += modulo;
  }
  return candidato;
}

@Component({
  selector: 'app-trip-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, BottomNavComponent, ArgNumberPipe],
  templateUrl: './trip-form.component.html',
  styleUrl: './trip-form.component.scss',
})
export class TripFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tripService = inject(TripService);
  private vehicleService = inject(VehicleService);
  private auth = inject(AuthService);

  vehicleId = Number(this.route.snapshot.paramMap.get('id'));
  returnTo = this.route.snapshot.queryParamMap.get('returnTo');

  /** Km inicial por defecto para un registro nuevo (último km del vehículo). */
  private defaultStartKm = 0;

  loading = signal(false);
  loadingContext = signal(true);
  errorMessage = signal<string | null>(null);

  useShortcut = signal(true);
  userName = signal('');
  editingTripId = signal<number | null>(null);
  lastOwnTrip = signal<Trip | null>(null);

  form = this.fb.nonNullable.group({
    trip_date: [this.today(), Validators.required],
    start_km: [0, [Validators.required, Validators.min(0)]],
    end_km_shortcut: ['', [Validators.pattern(/^\d{1,3}$/)]],
    end_km_full: [null as number | null],
  });

  editingTripUserName = signal<string | null>(null);

  ngOnInit(): void {
    // si venimos desde el historial a editar un viaje puntual (propio o
    // ajeno, según permisos), viene marcado en la URL: ?tripId=123
    const tripIdToEdit = this.route.snapshot.queryParamMap.get('tripId');

    // desde un "Km sin registrar" del historial: ?kmInicio=12345 abre el form
    // con el km inicial del hueco ya prefijado en vez del último km registrado
    const kmInicioRaw = this.route.snapshot.queryParamMap.get('kmInicio');
    const kmInicio = kmInicioRaw === null ? NaN : Number(kmInicioRaw);
    const gapStartKm = Number.isFinite(kmInicio) && kmInicio >= 0 ? kmInicio : null;

    // Velocidad: usuario, vehículo y viajes son independientes -> paralelo.
    // fetchMe es resiliente: si falla, el formulario igual se arma (solo se
    // pierde el nombre del usuario logueado por defecto).
    forkJoin({
      user: this.auth.fetchMe().pipe(catchError(() => of(null))),
      vehicle: this.vehicleService.get(this.vehicleId),
      trips: this.tripService.listByVehicle(this.vehicleId),
    }).subscribe({
      next: ({ user, vehicle, trips }) => {
        if (user) this.userName.set(user.name);

        const lastRegisteredTrip = trips.reduce<Trip | null>(
          (latest, t) => (!latest || t.id > latest.id ? t : latest),
          null,
        );
        this.defaultStartKm =
          gapStartKm ??
          (lastRegisteredTrip ? lastRegisteredTrip.end_km : vehicle.current_km);
        this.form.patchValue({ start_km: this.defaultStartKm });

        const ownTrips = user
          ? trips
              .filter((t) => t.user === user.id)
              .sort((a, b) =>
                a.trip_date === b.trip_date ? b.id - a.id : a.trip_date < b.trip_date ? 1 : -1,
              )
          : [];
        this.lastOwnTrip.set(ownTrips[0] ?? null);

        if (tripIdToEdit) {
          const trip = trips.find((t) => t.id === Number(tripIdToEdit));
          if (trip) {
            this.applyTripToForm(trip);
            // Si el viaje es de otro usuario, traer su nombre
            if (user && trip.user !== user.id) {
              this.auth.getUserById(trip.user).subscribe({
                next: (u) => this.editingTripUserName.set(u.name),
              });
            }
          }
        }

        this.loadingContext.set(false);
      },
      error: () => this.loadingContext.set(false),
    });
  }

  get computedEndKm(): number | null {
    const startKm = this.form.controls.start_km.value;

    if (this.useShortcut()) {
      const raw = this.form.controls.end_km_shortcut.value;
      if (!raw || !/^\d{1,3}$/.test(raw)) return null;
      return calcularKmFinal(startKm, raw);
    }
    return this.form.controls.end_km_full.value;
  }

  get kmTraveled(): number | null {
    const end = this.computedEndKm;
    const start = this.form.controls.start_km.value;
    if (end === null) return null;
    const traveled = end - start;
    return traveled > 0 ? traveled : null;
  }

  toggleShortcut(): void {
    this.useShortcut.update((v) => !v);
    this.form.patchValue({ end_km_shortcut: '', end_km_full: null });
  }

  goBack(): void {
    const rt = this.returnTo;
    if (rt === 'viaje') {
      // Ya estamos en la pantalla de viaje; no hay URL distinta a la que
      // navegar (la navegación a la misma ruta se ignora). Solo salimos
      // del modo edición y reseteamos el formulario a registro nuevo.
      this.exitEditMode();
      return;
    }
    if (rt === 'week') {
      this.router.navigate(['/vehiculo', this.vehicleId, 'historial', 'semana']);
    } else if (rt === 'full') {
      this.router.navigate(['/vehiculo', this.vehicleId, 'historial']);
    } else {
      this.router.navigate(['/vehiculo', this.vehicleId]);
    }
  }

  private exitEditMode(): void {
    if (!this.editingTripId()) return;
    this.returnTo = null;
    this.editingTripId.set(null);
    this.editingTripUserName.set(null);
    this.useShortcut.set(true);
    this.errorMessage.set(null);
    this.form.reset({
      trip_date: this.today(),
      start_km: this.defaultStartKm,
      end_km_shortcut: '',
      end_km_full: null,
    });
  }

  /** Al confirmar un cambio desde la pantalla de viaje, vuelve a pedir los
   *  viajes al backend para que la tarjeta "Tu último registro" y el km
   *  inicial por defecto reflejen el viaje recién editado. */
  private reloadContext(): void {
    this.tripService.listByVehicle(this.vehicleId).subscribe({
      next: (trips) => {
        const lastRegisteredTrip = trips.reduce<Trip | null>(
          (latest, t) => (!latest || t.id > latest.id ? t : latest),
          null,
        );
        if (lastRegisteredTrip) this.defaultStartKm = lastRegisteredTrip.end_km;

        const userId = this.auth.getCurrentUser()?.id;
        const ownTrips = userId
          ? trips
              .filter((t) => t.user === userId)
              .sort((a, b) =>
                a.trip_date === b.trip_date ? b.id - a.id : a.trip_date < b.trip_date ? 1 : -1,
              )
          : [];
        this.lastOwnTrip.set(ownTrips[0] ?? null);
        this.exitEditMode();
      },
      error: () => this.exitEditMode(),
    });
  }

  editLastTrip(): void {
    const trip = this.lastOwnTrip();
    if (!trip) return;
    this.returnTo = 'viaje';
    this.applyTripToForm(trip);
  }

  private applyTripToForm(trip: Trip): void {
    this.editingTripId.set(trip.id);
    this.useShortcut.set(false);
    this.form.patchValue({
      trip_date: trip.trip_date,
      start_km: trip.start_km,
      end_km_full: trip.end_km,
    });
  }

  submit(): void {
    const startKm = this.form.controls.start_km.value;
    const endKm = this.computedEndKm;
    const tripDate = this.form.controls.trip_date.value;

    if (this.form.controls.start_km.invalid || !endKm || !tripDate) {
      this.form.markAllAsTouched();
      this.errorMessage.set('Completá la fecha, el km inicial y el km final.');
      return;
    }

    if (endKm <= startKm) {
      this.errorMessage.set('El km final tiene que ser mayor al km inicial.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const payload = { trip_date: tripDate, start_km: startKm, end_km: endKm };
    const editingId = this.editingTripId();

    const request$ = editingId
      ? this.tripService.update(editingId, payload)
      : this.tripService.create({ vehicle: this.vehicleId, ...payload });

    request$.subscribe({
      next: () => {
        this.loading.set(false);
        // el viaje cambió -> el dashboard cacheado (resumen/historial) y la
        // lista de viajes cacheada (esta misma pantalla) quedan viejos
        this.vehicleService.invalidate(this.vehicleId);
        this.tripService.invalidateVehicle(this.vehicleId);
        if (this.returnTo === 'viaje') {
          this.reloadContext();
        } else {
          this.goBack();
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(
          err.error?.non_field_errors?.[0] ??
            err.error?.end_km?.[0] ??
            'No pudimos guardar el viaje. Revisá los datos. Si el error persiste, puede ser que no tengas permiso para editar este viaje.',
        );
      },
    });
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
