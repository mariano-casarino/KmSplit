import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../environments/environment';
import { Trip } from '../models/trip.model';
import { TripService } from './trip.service';

const tripsUrl = `${environment.apiUrl}/trips/`;

const trip: Trip = {
  id: 1,
  vehicle: 1,
  user: 3,
  settlement: null,
  trip_date: '2026-09-01',
  start_km: 1000,
  end_km: 1050,
  km_traveled: 50,
  edited_by: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

describe('TripService (cache de listByVehicle)', () => {
  let service: TripService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TripService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('cachela listByVehicle() por vehículo y no repite la request', () => {
    service.listByVehicle(1).subscribe((trips) => expect(trips).toEqual([trip]));
    http.expectOne(`${tripsUrl}?vehicle=1`).flush([trip]);

    service.listByVehicle(1).subscribe((trips) => expect(trips).toEqual([trip]));
    expect(http.match(`${tripsUrl}?vehicle=1`)).toEqual([]);
  });

  it('distingue vehículos distintos', () => {
    service.listByVehicle(1).subscribe();
    http.expectOne(`${tripsUrl}?vehicle=1`).flush([trip]);

    service.listByVehicle(2).subscribe();
    http.expectOne(`${tripsUrl}?vehicle=2`).flush([{ ...trip, id: 2, vehicle: 2 }]);

    // volver al 1 sale del cache: sin request nuevo
    service.listByVehicle(1).subscribe();
    expect(http.match(`${tripsUrl}?vehicle=1`)).toEqual([]);
  });

  it('invalidateVehicle() limpia el cache de ese vehículo', () => {
    service.listByVehicle(1).subscribe();
    http.expectOne(`${tripsUrl}?vehicle=1`).flush([trip]);

    service.invalidateVehicle(1);

    service.listByVehicle(1).subscribe();
    http.expectOne(`${tripsUrl}?vehicle=1`).flush([trip]);
  });

  it('invalidateVehicle() solo limpia el vehículo indicado', () => {
    service.listByVehicle(1).subscribe();
    http.expectOne(`${tripsUrl}?vehicle=1`).flush([trip]);
    service.listByVehicle(2).subscribe();
    http.expectOne(`${tripsUrl}?vehicle=2`).flush([{ ...trip, id: 2, vehicle: 2 }]);

    service.invalidateVehicle(1);

    // el 1 se re-pide, el 2 sale del cache
    service.listByVehicle(1).subscribe();
    http.expectOne(`${tripsUrl}?vehicle=1`).flush([trip]);
    service.listByVehicle(2).subscribe();
    expect(http.match(`${tripsUrl}?vehicle=2`)).toEqual([]);
  });
});