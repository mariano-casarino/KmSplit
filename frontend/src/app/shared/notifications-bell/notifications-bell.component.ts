import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Component, computed, inject, signal } from '@angular/core';

import { Notification } from '../../core/models/notification.model';
import { NotificationService } from '../../core/services/notification.service';
import { notificationTarget } from '../../core/utils/records';

/** Cuántas notificaciones muestra el panel. El resto está en la vista de
 *  "ver todas", así el panel no tapa la pantalla. */
const PANEL_ITEMS = 3;

/**
 * Campana de notificaciones: badge con el contador de no leídas y, al tocar,
 * un panel con las últimas. Cada item navega a su destino y se marca como
 * leído. El contador lo mantiene NotificationService (polling).
 */
@Component({
  selector: 'app-notifications-bell',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notifications-bell.component.html',
  styleUrl: './notifications-bell.component.scss',
})
export class NotificationsBellComponent {
  protected open = signal(false);
  protected loading = signal(false);
  protected unreadCount = signal(0);
  protected items = signal<Notification[]>([]);
  protected displayCount = computed(() =>
    this.unreadCount() > 99 ? '99+' : String(this.unreadCount()),
  );
  /** Solo las 3 primeras: el resto se ve en la vista de notificaciones. */
  protected visibleItems = computed(() => this.items().slice(0, PANEL_ITEMS));

  private service = inject(NotificationService);
  private router = inject(Router);

  constructor() {
    this.service.unreadCount$.subscribe((count) => this.unreadCount.set(count));
    this.service.items$.subscribe((items) => {
      this.items.set(items);
      this.loading.set(false);
    });
  }

  toggle(): void {
    this.open.update((o) => !o);
    if (this.open()) {
      this.loading.set(true);
      this.service.load();
    }
  }

  close(): void {
    this.open.set(false);
  }

  markAllRead(): void {
    this.service.markAllRead();
  }

  /** Cierra el panel y lleva a la vista con todas las notificaciones. */
  openAll(): void {
    this.close();
    this.router.navigate(['/notificaciones']);
  }

  openItem(item: Notification): void {
    this.service.markRead(item.id);
    this.close();

    // Con record_id sabemos qué registro es: vamos al resumen pidiendo el
    // resaltado. El resumen/historial se encargan de bajarse al historial (o a
    // los últimos 7 días) si el registro no está a la vista. Las
    // notificaciones viejas (sin record_id) caen en la lista de registros.
    const target = notificationTarget({
      vehicleId: item.vehicle_id,
      kind: item.kind,
      recordId: item.record_id,
      createdAt: item.created_at,
    });

    if (target) {
      this.router.navigate(target.segments, {
        queryParams: target.highlight ? { highlight: target.highlight } : {},
      });
      return;
    }

    if (item.link) {
      this.router.navigateByUrl(item.link);
    }
  }
}