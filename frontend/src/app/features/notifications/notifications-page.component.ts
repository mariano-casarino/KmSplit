import { CommonModule, Location } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Notification } from '../../core/models/notification.model';
import { NotificationService, PAGE_LIMIT } from '../../core/services/notification.service';
import { notificationTarget } from '../../core/utils/records';
import { BackButtonComponent } from '../../shared/back-button/back-button.component';

/**
 * Vista exclusiva de notificaciones (la "?ver todas" del panel de la campana).
 * Existe para no tapar el contenido de la pantalla en la que se está: acá
 * hay lista completa, paginada, con "marcar todas".
 */
@Component({
  selector: 'app-notifications-page',
  standalone: true,
  imports: [CommonModule, BackButtonComponent],
  templateUrl: './notifications-page.component.html',
  styleUrl: './notifications-page.component.scss',
})
export class NotificationsPageComponent implements OnInit {
  private service = inject(NotificationService);
  private router = inject(Router);
  private location = inject(Location);

  items = signal<Notification[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  /** Si la última tanda vino completa, puede haber más para cargar. */
  hasMore = signal(false);
  errorMessage = signal<string | null>(null);
  unreadCount = signal(0);

  ngOnInit(): void {
    this.service.unreadCount$.subscribe((count) => this.unreadCount.set(count));
    // el contador viene del polling: lo refrescamos por si quedó desfasado
    this.service.refreshUnread();
    this.loadPage(0, true);
  }

  /** Esta vista siempre se abre desde la campana, así que el volver devuelve
   *  a la pantalla en la que se estaba. Si se entró por URL directa no hay
   *  historial al que volver y se va al selector de grupos. */
  back(): void {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/grupos', 'selector']);
    }
  }

  markAllRead(): void {
    this.service.markAllRead();
    this.items.update((list) => list.map((n) => ({ ...n, is_read: true })));
  }

  loadMore(): void {
    this.loadPage(this.items().length, false);
  }

  openItem(item: Notification): void {
    if (!item.is_read) {
      this.service.markRead(item.id, true);
      this.items.update((list) =>
        list.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)),
      );
    }

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

    if (item.link) this.router.navigateByUrl(item.link);
  }

  private loadPage(offset: number, first: boolean): void {
    if (first) {
      this.loading.set(true);
    } else {
      this.loadingMore.set(true);
    }
    this.errorMessage.set(null);

    this.service.fetch(PAGE_LIMIT, offset).subscribe({
      next: (batch) => {
        this.items.update((list) => (first ? batch : [...list, ...batch]));
        this.hasMore.set(batch.length === PAGE_LIMIT);
        this.loading.set(false);
        this.loadingMore.set(false);
      },
      error: () => {
        this.errorMessage.set('No pudimos cargar las notificaciones.');
        this.loading.set(false);
        this.loadingMore.set(false);
      },
    });
  }
}
