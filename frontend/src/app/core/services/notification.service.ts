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

  private currentVehicleId: number | null = null;

  /** Arranca el refresco periódico + el refresco al volver a la pestaña. */
  startPolling(vehicleId?: number | null): void {
    this.currentVehicleId = vehicleId ?? null;
    if (this.pollTimer) return;
    this.refreshUnread(this.currentVehicleId);
    this.pollTimer = setInterval(() => this.refreshUnread(this.currentVehicleId), POLL_INTERVAL_MS);
    this.visibilityHandler = () => {
      if (!document.hidden) this.refreshUnread(this.currentVehicleId);
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
  refreshUnread(vehicleId?: number | null): void {
    const params: Record<string, string> = {};
    if (vehicleId) params['vehicle'] = String(vehicleId);
    this.http
      .get<any>(`${this.baseUrl}unread_count/`, { params })
      .subscribe({ next: (res) => this.unreadCountSubject.next(Number(res?.count ?? 0)) });
  }

  /** Trae una porción de la lista (la más reciente primero). Se usa tanto
   *  para el panel de la campana como para la vista de "ver todas", que la
   *  va paginando con `offset`. */
  fetch(limit: number, offset = 0, vehicleId?: number | null): Observable<Notification[]> {
    const params: Record<string, string> = { limit: String(limit), offset: String(offset) };
    if (vehicleId) {
      params['vehicle'] = String(vehicleId);
    }
    return this.http.get<Notification[]>(`${this.baseUrl}`, { params });
  }

  /** Trae la lista para el panel de la campana. */
  load(vehicleId?: number | null): void {
    this.fetch(PANEL_LIMIT, 0, vehicleId).subscribe({
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
  markAllRead(vehicleId?: number | null): void {
    const vid = vehicleId ?? this.currentVehicleId;
    this.unreadCountSubject.next(0);
    this.itemsSubject.next(this.itemsSubject.getValue().map((n) => ({ ...n, is_read: true })));
    const params: Record<string, string> = {};
    if (vid) params['vehicle'] = String(vid);
    this.http.post(`${this.baseUrl}read_all/`, {}, { params }).subscribe();
  }
}