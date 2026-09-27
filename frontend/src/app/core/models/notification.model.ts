export type NotificationKind = 'trip' | 'fuel';

/** Notificación in-app de GET /api/notifications/ */
export interface Notification {
  id: number;
  kind: NotificationKind;
  actor_name: string;
  message: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

export interface UnreadCount {
  count: number;
}