import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Component, computed, inject, signal } from '@angular/core';

import { Notification } from '../../core/models/notification.model';
import { NotificationService } from '../../core/services/notification.service';

/**
 * Campana de notificaciones: badge con el contador de no leídas y, al tocar,
 * un panel con la lista reciente. Cada item navega a su destino y se marca
 * como leído. El contador lo mantiene NotificationService (polling).
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

  openItem(item: Notification): void {
    this.service.markRead(item.id);
    this.close();
    if (item.link) {
      this.router.navigateByUrl(item.link);
    }
  }
}