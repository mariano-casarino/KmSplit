import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../environments/environment';
import { Group, GroupMembership } from '../models/group.model';
import { GroupService } from './group.service';

const listUrl = `${environment.apiUrl}/groups/`;

const group: Group = {
  id: 7,
  name: 'Familia',
  avatar_url: '',
  invite_code: 'ABC123',
  created_by: 1,
  created_at: '2026-01-01T00:00:00Z',
  members: [],
};

describe('GroupService (cache en memoria)', () => {
  let service: GroupService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(GroupService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('cachela list() y no repite la request', () => {
    service.list().subscribe((groups) => expect(groups).toEqual([group]));
    http.expectOne(listUrl).flush([group]);

    service.list().subscribe((groups) => expect(groups).toEqual([group]));
    expect(http.match(listUrl)).toEqual([]);
  });

  it('cachela get() por grupo y no repite la request', () => {
    service.get(7).subscribe((g) => expect(g.name).toBe('Familia'));
    http.expectOne(`${listUrl}7/`).flush(group);

    service.get(7).subscribe();
    expect(http.match(`${listUrl}7/`)).toEqual([]);
  });

  it('create() limpia la lista para que el grupo nuevo aparezca', () => {
    service.list().subscribe();
    http.expectOne(listUrl).flush([group]);

    service.create('Nuevo grupo').subscribe();
    http.expectOne(listUrl).flush({ ...group, id: 8, name: 'Nuevo grupo' });

    service.list().subscribe();
    http.expectOne(listUrl).flush([group]);
  });

  it('join() limpia la lista', () => {
    service.list().subscribe();
    http.expectOne(listUrl).flush([group]);

    service.join('CODIGO').subscribe();
    http.expectOne(`${listUrl}join/`).flush(group);

    service.list().subscribe();
    http.expectOne(listUrl).flush([group]);
  });

  it('leave() invalida lista y detalles', () => {
    service.list().subscribe();
    http.expectOne(listUrl).flush([group]);
    service.get(7).subscribe();
    http.expectOne(`${listUrl}7/`).flush(group);

    service.leave(7).subscribe();
    http.expectOne(`${listUrl}7/leave/`).flush({ detail: 'ok' });

    service.list().subscribe();
    http.expectOne(listUrl).flush([]);
    service.get(7).subscribe();
    http.expectOne(`${listUrl}7/`).flush(group);
  });

  it('updateMember() invalida lista y detalles', () => {
    service.list().subscribe();
    http.expectOne(listUrl).flush([group]);

    service.updateMember(7, 3, { role: 'admin' }).subscribe();
    http.expectOne(`${listUrl}7/members/3/`).flush({
      id: 3,
      user: 3,
      user_name: 'Ana',
      user_email: 'ana@mail.com',
      group: 7,
      role: 'admin',
      is_active: true,
      joined_at: '2026-01-01T00:00:00Z',
    } as unknown as GroupMembership);

    service.list().subscribe();
    http.expectOne(listUrl).flush([group]);
  });
});