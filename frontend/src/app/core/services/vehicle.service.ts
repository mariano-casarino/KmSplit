import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Dashboard, Vehicle } from '../models/vehicle.model';

/** Cuánto vive la data cacheada en memoria. Evita re-pedir lo mismo al
 *  servidor en cada navegación (~0.3s de RTT por request). Las mutaciones
 *  invalidan las entradas afectadas (invalidate()), así que el dato stale
 *  solo puede durar este TTL si la invalidación se olvidara en algún flujo. */
const CACHE_TTL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class VehicleService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/vehicles`;

  private static readonly LAST_VEHICLE_KEY = 'kmsplit_last_vehicle';

  /** Cache simple en memoria: id -> { vehicle, fetchedAt }. Evita requests
   *  repetidas del mismo vehículo entre pantallas de una misma sesión. */
  private cache = new Map<number, { vehicle: Vehicle; fetchedAt: number }>();

  /** Cache del dashboard (la vista más pesada): id -> { data, fetchedAt }. */
  private dashboardCache = new Map<number, { data: Dashboard; fetchedAt: number }>();

  /** Cache de la lista completa de vehículos. */
  private listCache: { vehicles: Vehicle[]; fetchedAt: number } | null = null;

  list(): Observable<Vehicle[]> {
    if (this.listCache && Date.now() - this.listCache.fetchedAt < CACHE_TTL_MS) {
      return of(this.listCache.vehicles);
    }
    return this.http.get<Vehicle[]>(`${this.baseUrl}/`).pipe(
      tap((vehicles) => {
        this.listCache = { vehicles, fetchedAt: Date.now() };
      }),
    );
  }

  get(id: number): Observable<Vehicle> {
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
      return of(hit.vehicle);
    }
    return this.http.get<Vehicle>(`${this.baseUrl}/${id}/`).pipe(
      tap((vehicle) => this.cache.set(id, { vehicle, fetchedAt: Date.now() })),
    );
  }

  /** Endpoint consolidado: vehicle + group + trips + fuelLoads + settlements
   *  en 1 sola request. La respuesta se cachea en memoria (TTL 60s) para que
   *  resumen/historial/liquidaciones naveguen al instante; se invalida al
   *  registrar o editar viajes/cargas (invalidate()). */
  dashboard(id: number): Observable<Dashboard> {
    const hit = this.dashboardCache.get(id);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
      return of(hit.data);
    }
    return this.http.get<Dashboard>(`${this.baseUrl}/${id}/dashboard/`).pipe(
      tap((data) => this.dashboardCache.set(id, { data, fetchedAt: Date.now() })),
    );
  }

  /** Limpia los caches de un vehículo (lista, detalle y dashboard). Llamar
   *  después de cualquier mutación que cambie su data (viaje, carga, foto...). */
  invalidate(id?: number): void {
    this.listCache = null;
    if (id !== undefined) {
      this.cache.delete(id);
      this.dashboardCache.delete(id);
    }
  }

  create(data: Partial<Vehicle>): Observable<Vehicle> {
    return this.http.post<Vehicle>(`${this.baseUrl}/`, data).pipe(
      tap((vehicle) => {
        this.cache.set(vehicle.id, { vehicle, fetchedAt: Date.now() });
        this.listCache = null;
      }),
    );
  }

  update(id: number, data: Partial<Vehicle>): Observable<Vehicle> {
    return this.http.patch<Vehicle>(`${this.baseUrl}/${id}/`, data).pipe(
      tap((updated) => {
        this.cache.set(id, { vehicle: updated, fetchedAt: Date.now() });
        this.dashboardCache.delete(id);
        this.listCache = null;
      }),
    );
  }

  /** Último vehículo que el usuario estuvo viendo, para volver a él por defecto. */
  setLastVehicleId(id: number): void {
    localStorage.setItem(VehicleService.LAST_VEHICLE_KEY, String(id));
  }

  getLastVehicleId(): number | null {
    const raw = localStorage.getItem(VehicleService.LAST_VEHICLE_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  clearLastVehicle(): void {
    localStorage.removeItem(VehicleService.LAST_VEHICLE_KEY);
  }
}