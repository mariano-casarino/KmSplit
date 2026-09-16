import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../environments/environment';
import { Settlement } from '../models/settlement.model';
import { SettlementService } from './settlement.service';

const url = `${environment.apiUrl}/settlements`;

const settlement: Settlement = {
  id: 1,
  vehicle: 1,
  fuel_load: 9,
  period_start_km: 10000,
  period_end_km: 12000,
  total_amount: 45000,
  unassigned_km: 0,
  status: 'pendiente',
  status_updated_by: null,
  load_date: '2026-09-01',
  loaded_by_name: 'Ana',
  created_at: '2026-09-01T00:00:00Z',
  details: [],
};

describe('SettlementService', () => {
  let service: SettlementService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SettlementService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('listByVehicle() hace GET /settlements/?vehicle=', () => {
    service.listByVehicle(1).subscribe((items) => expect(items).toEqual([settlement]));
    const req = http.expectOne(`${url}/?vehicle=1`);
    expect(req.request.method).toBe('GET');
    req.flush([settlement]);
  });

  it('get() hace GET /settlements/:id/', () => {
    service.get(1).subscribe((item) => expect(item).toEqual(settlement));
    const req = http.expectOne(`${url}/1/`);
    expect(req.request.method).toBe('GET');
    req.flush(settlement);
  });

  it('markStatus() hace PATCH /settlements/:id/mark_status/ con el estado', () => {
    service.markStatus(1, 'pagado').subscribe((item) => expect(item.status).toBe('pagado'));
    const req = http.expectOne(`${url}/1/mark_status/`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'pagado' });
    req.flush({ ...settlement, status: 'pagado' });
  });
});