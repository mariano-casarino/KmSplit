import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Trip } from '../models/trip.model';

/** Cuánto vive la lista de viajes cacheada en memoria. En la pantalla "viaje"
 *  (trip-form) es el único request que hoy se repite en cada visita (~0.3s de
 *  RTT). Al registrar/editar un viaje se invalida (invalidateVehicle()), así
 *  que el dato stale solo puede durar este TTL si se rompe la invalidación. */
const CACHE_TTL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class TripService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/trips`;

  /** Cache por vehículo: vehicleId -> { trips, fetchedAt }. */
  private listCache = new Map<number, { trips: Trip[]; fetchedAt: number }>();

  listByVehicle(vehicleId: number): Observable<Trip[]> {
    const hit = this.listCache.get(vehicleId);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
      return of(hit.trips);
    }
    return this.http.get<Trip[]>(`${this.baseUrl}/`, { params: { vehicle: vehicleId } }).pipe(
      tap((trips) => this.listCache.set(vehicleId, { trips, fetchedAt: Date.now() })),
    );
  }

  /** Limpia la lista cacheada de un vehículo. Llamar tras registrar/editar
   *  para que "Tu último registro" y el km inicial por defecto se refresquen. */
  invalidateVehicle(vehicleId: number): void {
    this.listCache.delete(vehicleId);
  }

  create(data: {
    vehicle: number;
    trip_date: string;
    start_km: number;
    end_km: number;
  }): Observable<Trip> {
    return this.http.post<Trip>(`${this.baseUrl}/`, data);
  }

  update(id: number, data: Partial<Trip>): Observable<Trip> {
    return this.http.patch<Trip>(`${this.baseUrl}/${id}/`, data);
  }
}