import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AuthService } from './core/services/auth.service';
import { NotificationService } from './core/services/notification.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  constructor() {
    const auth = inject(AuthService);
    const notifications = inject(NotificationService);

    // El polling de notificaciones vive solo mientras hay sesión: arranca
    // cuando aparece el usuario logueado y se detiene al desloguearse.
    auth.currentUser$.subscribe((user) => {
      if (user) {
        notifications.startPolling();
      } else {
        notifications.stopPolling();
      }
    });
  }
}