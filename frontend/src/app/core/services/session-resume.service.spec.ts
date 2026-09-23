import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../environments/environment';
import { Vehicle } from '../models/vehicle.model';
import { GroupService } from './group.service';
import { SessionResumeService } from './session-resume.service';
import { VehicleService } from './vehicle.service';

const groupsUrl = `${environment.apiUrl}/groups/`;
const vehiclesUrl = `${environment.apiUrl}/vehicles/`;

const group = (id: number, name: string) => ({
  id,
  name,
  invite_code: `INV${id}`,
  created_by: 1,
  created_at: '2026-01-01T00:00:00Z',
  members: [],
});

const vehicle = (id: number, groupId: number): Vehicle => ({
  id,
  group: groupId,
  name: `Auto ${id}`,
  fuel_type: 'nafta',
  photo_url: '',
  current_km: 1000,
  split_unassigned_km_all_members: false,
  created_at: '2026-01-01T00:00:00Z',
});

describe('SessionResumeService (auto-redirect tras login)', () => {
  let service: SessionResumeService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SessionResumeService);
    http = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => {
    http.verify();
  });

  it('sin grupos va al onboarding', () => {
    service.resumeRoute().subscribe((route) => expect(route).toEqual(['/grupos/nuevo']));
    http.expectOne(groupsUrl).flush([]);
    expect(http.match(vehiclesUrl)).toEqual([]);
  });

  it('con grupo activo y último vehículo de ese grupo, va directo al vehículo', () => {
    localStorage.setItem('kmsplit_active_group', '7');
    localStorage.setItem('kmsplit_last_vehicle', '3');

    service.resumeRoute().subscribe((route) => expect(route).toEqual(['/vehiculo', '3']));
    http.expectOne(groupsUrl).flush([group(7, 'Familia')]);
    http.expectOne(vehiclesUrl).flush([vehicle(3, 7), vehicle(4, 8)]);
  });

  it('si el último vehículo ya no está en el grupo, va al selector de vehículos', () => {
    localStorage.setItem('kmsplit_active_group', '7');
    localStorage.setItem('kmsplit_last_vehicle', '4');

    service.resumeRoute().subscribe((route) => expect(route).toEqual(['/vehiculos']));
    http.expectOne(groupsUrl).flush([group(7, 'Familia')]);
    http.expectOne(vehiclesUrl).flush([vehicle(3, 7)]);
  });

  it('deja activo el grupo elegido', () => {
    localStorage.setItem('kmsplit_active_group', '7');

    service.resumeRoute().subscribe(() => {
      const active = TestBed.inject(GroupService).getActiveGroupId();
      expect(active).toBe(7);
    });
    http.expectOne(groupsUrl).flush([group(7, 'Familia')]);
    http.expectOne(vehiclesUrl).flush([vehicle(3, 7)]);
  });

  it('si el grupo activo ya no existe, usa el de acceso más reciente', () => {
    localStorage.setItem('kmsplit_active_group', '99');
    localStorage.setItem('kmsplit_last_group_access', JSON.stringify({ 7: 1000, 8: 5000 }));

    service.resumeRoute().subscribe(() => {
      const active = TestBed.inject(GroupService).getActiveGroupId();
      const lastVehicle = TestBed.inject(VehicleService).getLastVehicleId();
      expect(active).toBe(8);
      expect(lastVehicle).toBeNull();
    });
    http.expectOne(groupsUrl).flush([group(7, 'A'), group(8, 'B')]);
    http.expectOne(vehiclesUrl).flush([vehicle(1, 8)]);
  });
});