import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../environments/environment';
import { Dashboard, Vehicle } from '../models/vehicle.model';
import { VehicleService } from './vehicle.service';

const listUrl = `${environment.apiUrl}/vehicles/`;

const vehicle: Vehicle = {
  id: 1,
  group: 7,
  name: 'Duster',
  fuel_type: 'nafta',
  photo_url: '',
  current_km: 1000,
  split_unassigned_km_all_members: false,
  created_at: '2026-01-01T00:00:00Z',
};

const dashboard: Dashboard = {
  vehicle,
  group: {
    id: 7,
    name: 'Familia',
    avatar_url: '',
    invite_code: 'ABC123',
    created_by: 1,
    created_at: '2026-01-01T00:00:00Z',
    members: [],
  },
  trips: [],
  fuel_loads: [],
  settlements: [],
};

describe('VehicleService (cache en memoria)', () => {
  let service: VehicleService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(VehicleService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('cachela list() y no repite la request', () => {
    service.list().subscribe((vehicles) => expect(vehicles).toEqual([vehicle]));
    http.expectOne(listUrl).flush([vehicle]);

    service.list().subscribe((vehicles) => expect(vehicles).toEqual([vehicle]));
    expect(http.match(listUrl)).toEqual([]);
  });

  it('cachela dashboard() por vehículo y no repite la request', () => {
    service.dashboard(1).subscribe((data) => expect(data.vehicle.name).toBe('Duster'));
    http.expectOne(`${listUrl}1/dashboard/`).flush(dashboard);

    service.dashboard(1).subscribe();
    expect(http.match(`${listUrl}1/dashboard/`)).toEqual([]);
  });

  it('invalidate(id) limpia detalle y dashboard del vehículo', () => {
    service.get(1).subscribe();
    http.expectOne(`${listUrl}1/`).flush(vehicle);
    service.dashboard(1).subscribe();
    http.expectOne(`${listUrl}1/dashboard/`).flush(dashboard);

    service.invalidate(1);

    service.get(1).subscribe();
    http.expectOne(`${listUrl}1/`).flush(vehicle);
    service.dashboard(1).subscribe();
    http.expectOne(`${listUrl}1/dashboard/`).flush(dashboard);
  });

  it('invalidate() sin id también limpia la lista', () => {
    service.list().subscribe();
    http.expectOne(listUrl).flush([vehicle]);

    service.invalidate();

    service.list().subscribe();
    http.expectOne(listUrl).flush([vehicle]);
  });

  it('update() invalida dashboard y lista (los viajes cambiaron)', () => {
    service.dashboard(1).subscribe();
    http.expectOne(`${listUrl}1/dashboard/`).flush(dashboard);
    service.list().subscribe();
    http.expectOne(listUrl).flush([vehicle]);

    service.update(1, { name: 'Renegade' }).subscribe();
    http.expectOne(`${listUrl}1/`).flush({ ...vehicle, name: 'Renegade' });

    service.dashboard(1).subscribe();
    http.expectOne(`${listUrl}1/dashboard/`).flush(dashboard);
  });

  it('create() limpia la lista para que el vehículo nuevo aparezca', () => {
    service.list().subscribe();
    http.expectOne(listUrl).flush([vehicle]);

    service.create({ name: 'Nuevo', group: 7 }).subscribe();
    http.expectOne(listUrl).flush({ ...vehicle, id: 2, name: 'Nuevo' });

    service.list().subscribe();
    http.expectOne(listUrl).flush([vehicle]);
  });
});