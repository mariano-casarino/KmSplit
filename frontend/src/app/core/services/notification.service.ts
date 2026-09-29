import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Notification, UnreadCount } from '../models/notification.model';

export const POLL_INTERVAL_MS = 60_000;
/** Cuántas trae el panel de la campana. */
export const PANEL_LIMIT = 20;
/** Cuántas trae por tanda la vista de notificaciones ("ver todas"). */
export const PAGE_LIMIT = 25;

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

  /** Trae una porción de la lista (la más reciente primero). Se usa tanto
   *  para el panel de la campana como para la vista de "ver todas", que la
   *  va paginando con `offset`. */
  fetch(limit: number, offset = 0): Observable<Notification[]> {
    return this.http.get<Notification[]>(`${this.baseUrl}`, {
      params: { limit: String(limit), offset: String(offset) },
    });
  }

  /** Trae la lista para el panel de la campana. */
  load(): void {
    this.fetch(PANEL_LIMIT).subscribe({
      next: (items) => this.itemsSubject.next(items),
      error: () => this.itemsSubject.next([]),
    });
  }

  /** Marca una como leída y ajusta el contador local.
   *
   *  `wasUnread` lo pasan las pantallas que tienen su propia lista (la vista de
   *  "ver todas"), que no siempre está en el subject del panel: si se entra a
   *  esa vista sin abrir la campana, el item no está en el subject y sin este
   *  dato el contador no bajaría hasta el próximo polling. */
  markRead(id: number, wasUnread = true): void {
    const current = this.itemsSubject.getValue();
    const inPanel = current.find((n) => n.id === id);
    const unread = inPanel ? !inPanel.is_read : wasUnread;
    if (unread) {
      this.unreadCountSubject.next(Math.max(0, this.unreadCount - 1));
    }
    if (inPanel) {
      this.itemsSubject.next(
        current.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
    }
    this.http.post(`${this.baseUrl}${id}/read/`, {}).subscribe();
  }

  /** Marca todas como leídas. Siempre pega el endpoint: la lista de la vista
   *  "ver todas" no vive en el subject del panel, así que no se puede decidir
   *  con la lista local si hay algo sin leer. */
  markAllRead(): void {
    this.unreadCountSubject.next(0);
    this.itemsSubject.next(this.itemsSubject.getValue().map((n) => ({ ...n, is_read: true })));
    this.http.post(`${this.baseUrl}read_all/`, {}).subscribe();
  }
}