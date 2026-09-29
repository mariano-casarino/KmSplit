import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../environments/environment';
import { Notification } from '../models/notification.model';
import { NotificationService, POLL_INTERVAL_MS } from './notification.service';

const baseUrl = `${environment.apiUrl}/notifications/`;

const listRequest = (req: { url: string; params: { get: (k: string) => string | null } }) =>
  req.url === baseUrl && req.params.get('limit') === '20';

const notification: Notification = {
  id: 1,
  kind: 'trip',
  actor_name: 'Mariano',
  message: 'Mariano registró un viaje de 45 km el 02/07.',
  link: '/vehiculo/5/historial',
  record_id: 12,
  vehicle_id: 5,
  is_read: false,
  created_at: '2026-07-02T18:00:00Z',
};

describe('NotificationService', () => {
  let service: NotificationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(NotificationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('refreshUnread() actualiza el contador de no leídas', () => {
    service.refreshUnread();
    http.expectOne(`${baseUrl}unread_count/`).flush({ count: 3 });
    expect(service.unreadCount).toBe(3);
  });

  it('load() guarda la lista de notificaciones', () => {
    let loaded: Notification[] | null = null;
    service.items$.subscribe((items) => (loaded = items));

    service.load();
    http
      .expectOne(listRequest)
      .flush([notification]);

    expect(loaded).toHaveLength(1);
    expect(loaded![0].message).toContain('45 km');
  });

  it('markRead() marca local + llama al endpoint (una sola vez)', () => {
    service.load();
    const listReq = http.expectOne(listRequest);
    listReq.flush([notification]);

    service.markRead(notification.id);
    http.expectOne(`${baseUrl}${notification.id}/read/`).flush(null);

    expect(service.unreadCount).toBe(0);
  });

  it('markRead() con la lista del panel vacía usa wasUnread para el contador', () => {
    // caso real: se abre "ver todas" sin haber abierto la campana, así que
    // el subject del panel está vacío y no hay item del cual desconfiar
    service.refreshUnread();
    http.expectOne(`${baseUrl}unread_count/`).flush({ count: 2 });

    service.markRead(notification.id, true);
    http.expectOne(`${baseUrl}${notification.id}/read/`).flush(null);
    expect(service.unreadCount).toBe(1);

    // una que ya estaba leída no tiene que bajar el contador
    service.markRead(notification.id, false);
    http.expectOne(`${baseUrl}${notification.id}/read/`).flush(null);
    expect(service.unreadCount).toBe(1);
  });

  it('markAllRead() marca todo y llama a read_all', async () => {
    service.load();
    http.expectOne(listRequest).flush([
      notification,
      { ...notification, id: 2, kind: 'fuel', message: 'Carga de prueba.' },
    ]);

    service.markAllRead();
    http.expectOne(`${baseUrl}read_all/`).flush(null);

    expect(service.unreadCount).toBe(0);
  });

  it('startPolling() refresca de inmediato y en cada intervalo', () => {
    vi.useFakeTimers();

    service.startPolling();
    http.expectOne(`${baseUrl}unread_count/`).flush({ count: 1 });

    // también refresca al volver a la pestaña
    document.dispatchEvent(new Event('visibilitychange'));
    http.expectOne(`${baseUrl}unread_count/`).flush({ count: 1 });

    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    http.expectOne(`${baseUrl}unread_count/`).flush({ count: 2 });

    service.stopPolling();
    vi.useRealTimers();
  });

  it('stopPolling() limpia el estado de no leídas', () => {
    service.refreshUnread();
    http.expectOne(`${baseUrl}unread_count/`).flush({ count: 5 });

    service.stopPolling();
    expect(service.unreadCount).toBe(0);
  });
});
