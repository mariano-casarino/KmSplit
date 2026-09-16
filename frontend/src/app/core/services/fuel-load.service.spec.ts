import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../environments/environment';
import { FuelLoad } from '../models/fuel-load.model';
import { FuelLoadService, UpdateFuelLoadPayload } from './fuel-load.service';

const url = `${environment.apiUrl}/fuel-loads`;

const fuel: FuelLoad = {
  id: 1,
  vehicle: 1,
  loaded_by: 3,
  load_date: '2026-09-01',
  odometer_km: 12000,
  amount: 45000,
  liters: 30,
  created_at: '2026-09-01T00:00:00Z',
};

describe('FuelLoadService', () => {
  let service: FuelLoadService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(FuelLoadService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('listByVehicle() hace GET /fuel-loads/?vehicle=', () => {
    service.listByVehicle(1).subscribe((loads) => expect(loads).toEqual([fuel]));
    const req = http.expectOne(`${url}/?vehicle=1`);
    expect(req.request.method).toBe('GET');
    req.flush([fuel]);
  });

  it('get() hace GET /fuel-loads/:id/', () => {
    service.get(1).subscribe((load) => expect(load).toEqual(fuel));
    const req = http.expectOne(`${url}/1/`);
    expect(req.request.method).toBe('GET');
    req.flush(fuel);
  });

  it('create() hace POST con el payload', () => {
    service
      .create({ vehicle: 1, load_date: '2026-09-01', odometer_km: 12000, amount: 45000, liters: 30 })
      .subscribe((load) => expect(load).toEqual(fuel));
    const req = http.expectOne(`${url}/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      vehicle: 1,
      load_date: '2026-09-01',
      odometer_km: 12000,
      amount: 45000,
      liters: 30,
    });
    req.flush(fuel);
  });

  it('update() hace PATCH con solo los campos a cambiar', () => {
    const payload: UpdateFuelLoadPayload = { amount: 50000, liters: 33 };
    service.update(1, payload).subscribe();
    const req = http.expectOne(`${url}/1/`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(payload);
    req.flush({ ...fuel, amount: 50000 });
  });

  it('delete() hace DELETE /fuel-loads/:id/', () => {
    service.delete(1).subscribe();
    const req = http.expectOne(`${url}/1/`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});