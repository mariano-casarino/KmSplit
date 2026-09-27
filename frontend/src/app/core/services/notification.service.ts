import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Notification, UnreadCount } from '../models/notification.model';

export const POLL_INTERVAL_MS = 60_000;
const LIST_LIMIT = 20;

/**
 * Estado de las notificaciones in-app del usuario logueado.
 *
 * Mantiene en memoria el contador de no leídas (para el badge) y la lista
 * reciente (para el panel), y refresca el contador cada 60s + al traer la
 * app al frente. El badge se actualiza solo; la lista se vuelve a pedir cada
 * vez que se abre el panel.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/notifications/`;

  private readonly unreadCountSubject = new BehaviorSubject<number>(0);
  readonly unreadCount$ = this.unreadCountSubject.asObservable();

  private readonly itemsSubject = new BehaviorSubject<Notification[]>([]);
  readonly items$ = this.itemsSubject.asObservable();

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;

  get unreadCount(): number {
    return this.unreadCountSubject.getValue();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  /** Arranca el refresco periódico + el refresco al volver a la pestaña. */
  startPolling(): void {
    if (this.pollTimer) return;
    this.refreshUnread();
    this.pollTimer = setInterval(() => this.refreshUnread(), POLL_INTERVAL_MS);
    this.visibilityHandler = () => {
      if (!document.hidden) this.refreshUnread();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /** Detiene el polling y limpia el estado (se usa al desloguearse). */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.unreadCountSubject.next(0);
    this.itemsSubject.next([]);
  }

  /** Refresca el contador de no leídas (lightweight). Errores en silencio:
   *  el próximo tick lo reintenta. */
  refreshUnread(): void {
    this.http
      .get<UnreadCount>(`${this.baseUrl}unread_count/`)
      .subscribe({ next: ({ count }) => this.unreadCountSubject.next(count) });
  }

  /** Trae la lista de las últimas notificaciones. */
  load(): void {
    this.http
      .get<Notification[]>(`${this.baseUrl}`, {
        params: { limit: String(LIST_LIMIT) },
      })
      .subscribe({
        next: (items) => this.itemsSubject.next(items),
        error: () => this.itemsSubject.next([]),
      });
  }

  /** Marca una como leída y ajusta el contador local. */
  markRead(id: number): void {
    const current = this.itemsSubject.getValue();
    const item = current.find((n) => n.id === id);
    if (item && !item.is_read) {
      this.unreadCountSubject.next(Math.max(0, this.unreadCount - 1));
      this.itemsSubject.next(
        current.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
    }
    this.http.post(`${this.baseUrl}${id}/read/`, {}).subscribe();
  }

  /** Marca todas como leídas. */
  markAllRead(): void {
    const current = this.itemsSubject.getValue();
    if (!current.some((n) => !n.is_read)) return;
    this.unreadCountSubject.next(0);
    this.itemsSubject.next(current.map((n) => ({ ...n, is_read: true })));
    this.http.post(`${this.baseUrl}read_all/`, {}).subscribe();
  }
}