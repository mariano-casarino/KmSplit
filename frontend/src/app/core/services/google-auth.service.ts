import { Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string; error?: string }) => void;
            auto_select?: boolean;
            ux_mode?: 'popup' | 'redirect';
            cancel_on_tap_outside?: boolean;
          }) => void;
          prompt: (listener?: (notification: PromptNotification) => void) => void;
        };
      };
    };
  }
}

interface PromptNotification {
  getMomentType: () => string;
  isNotDisplayed: () => boolean;
  isSkippedMoment: () => boolean;
  isDismissedMoment: () => boolean;
}

/**
 * Wrapper fino sobre Google Identity Services (GIS).
 *
 * Carga el script de Google bajo demanda, e inicia sesión en un popup con
 * `ux_mode: 'popup'`. Resuelve con el id_token que después se manda al
 * backend (POST /api/auth/google/), que es quien verifica la firma.
 */
@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  private scriptPromise: Promise<void> | null = null;

  /** Client ID de la "Web application", tomado de environments. */
  get clientId(): string {
    return environment.googleClientId;
  }

  /** True si hay un client_id configurado (si no, no se muestra el botón). */
  get enabled(): boolean {
    return !!this.clientId;
  }

  private loadScript(): Promise<void> {
    if (this.scriptPromise) return this.scriptPromise;
    if (window.google?.accounts?.id) {
      this.scriptPromise = Promise.resolve();
      return this.scriptPromise;
    }
    this.scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        this.scriptPromise = null;
        reject(new Error('No se pudo cargar Google Sign-In.'));
      };
      document.head.appendChild(script);
    });
    return this.scriptPromise;
  }

  /**
   * Abre el popup de Google (requiere un gesto del usuario) y resuelve con el
   * id_token. Rechaza si el usuario cancela o cierra el popup.
   */
  signIn(): Promise<string> {
    if (!this.enabled) {
      return Promise.reject(new Error('Google no está configurado.'));
    }

    return this.loadScript().then(
      () =>
        new Promise<string>((resolve, reject) => {
          let settled = false;
          const g = window.google!.accounts.id;

          g.initialize({
            client_id: this.clientId,
            auto_select: false,
            ux_mode: 'popup',
            cancel_on_tap_outside: true,
            callback: (response) => {
              if (settled) return;
              if (response.credential) {
                settled = true;
                resolve(response.credential);
              } else if (response.error) {
                settled = true;
                reject(new Error('El inicio de sesión con Google fue cancelado.'));
              }
            },
          });

          g.prompt((notification) => {
            if (settled) return;
            if (notification.isDismissedMoment()) {
              settled = true;
              reject(new Error('El inicio de sesión con Google fue cancelado.'));
            }
          });
        }),
    );
  }
}