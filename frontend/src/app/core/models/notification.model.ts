export type NotificationKind = 'trip' | 'fuel';

/** Notificación in-app de GET /api/notifications/ */
export interface Notification {
  id: number;
  kind: NotificationKind;
  actor_name: string;
  message: string;
  link: string;
  /** Id del viaje o carga que originó el aviso (null si no aplica). */
  record_id: number | null;
  /** Vehículo donde pasó la acción, para armar la ruta al registro. */
  vehicle_id: number | null;
  is_read: boolean;
  created_at: string;
}

export interface UnreadCount {
  count: number;
}