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
   *
   * Garantiza siempre un desenlace: además de los casos de éxito/cancelación,
   * maneja las notificaciones de prompt de GIS (popup no mostrado, momento
   * saltado) y un timeout de seguridad, para que el botón jamás quede
   * girando indefinidamente.
   */
  signIn(): Promise<string> {
    if (!this.enabled) {
      return Promise.reject(new Error('Google no está configurado.'));
    }

    return this.loadScript().then(
      () =>
        new Promise<string>((resolve, reject) => {
          let settled = false;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const g = window.google!.accounts.id;

          const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            fn();
          };

          // Red de seguridad: aunque GIS no notifique nada, nunca quedamos
          // cargando para siempre.
          timeout = setTimeout(() => {
            finish(() =>
              reject(
                new Error('Google tardó demasiado en responder. Intentá de nuevo.'),
              ),
            );
          }, 120_000);

          g.initialize({
            client_id: this.clientId,
            auto_select: false,
            ux_mode: 'popup',
            cancel_on_tap_outside: true,
            callback: (response) => {
              const credential = response.credential;
              if (credential) {
                finish(() => resolve(credential));
              } else if (response.error) {
                finish(() =>
                  reject(new Error('El inicio de sesión con Google fue cancelado.')),
                );
              } else {
                // Popup cerrado sin credencial ni error: no hay nada que validar.
                finish(() =>
                  reject(new Error('Google cerró el popup sin completar el inicio de sesión.')),
                );
              }
            },
          });

          g.prompt((notification) => {
            if (notification.isNotDisplayed()) {
              // P. ej. el origen no está autorizado en Google Console o el
              // navegador bloqueó el popup.
              finish(() =>
                reject(
                  new Error(
                    'Google no pudo abrir el inicio de sesión. Verificá que este sitio esté autorizado en la consola de Google.',
                  ),
                ),
              );
            } else if (notification.isSkippedMoment()) {
              finish(() =>
                reject(
                  new Error('Google omitió el inicio de sesión. Intentá de nuevo.'),
                ),
              );
            } else if (notification.isDismissedMoment()) {
              finish(() =>
                reject(new Error('El inicio de sesión con Google fue cancelado.')),
              );
            }
          });
        }),
    );
  }
}