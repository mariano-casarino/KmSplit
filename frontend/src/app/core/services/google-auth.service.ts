import { Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';

const CSRF_COOKIE = 'g_csrf_token';
const RESULT_KEY = 'kmsplit_google_credential';
const NONCE_KEY = 'kmsplit_google_nonce';
const POPUP_W = 480;
const POPUP_H = 620;
const WAIT_MS = 120_000;

/** Token aleatorio para el doble envío g_csrf_token (cookie + query). */
const randomToken = (): string => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('');
};

/**
 * Login con Google sin Google Identity Services (GIS).
 *
 * GIS en mobile/iOS muestra el One Tap (la notificación inferior) y su popup
 * pierde el callback al volver, dejando el botón "cargando" o "sesión
 * expiró". Acá abrimos el flujo de autorización de Google directamente con
 * `window.open`:
 *   - desktop: ventana emergente real, centrada en la pantalla;
 *   - móvil: Safari/Chrome abre una pestaña nueva (iOS no permite ventanas
 *     centradas: es imposible evitarlo);
 *   - al volver, Google redirige a la ruta dedicada `/google/auth` con el
 *     `#credential` en la URL; esa página valida el g_csrf_token (evita
 *     login-CSRF), guarda la credencial en `localStorage` y se cierra. El
 *     flujo original la detecta y continúa — funciona sin importar de qué
 *     pestaña se vuelva.
 */
@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  /** Client ID de la "Web application", tomado de environments. */
  get clientId(): string {
    return environment.googleClientId;
  }

  /** True si hay un client_id configurado (si no, no se muestra el botón). */
  get enabled(): boolean {
    return !!this.clientId;
  }

  /**
   * Abre la ventana/pestaña de Google (requiere un gesto del usuario) y
   * resuelve con el id_token cuando la pestaña vuelve. Rechaza con un mensaje
   * claro si el popup se bloquea, se cancela o si Google tarda demasiado
   * (nunca queda cargando para siempre).
   */
  signIn(): Promise<string> {
    if (!this.enabled) {
      return Promise.reject(new Error('Google no está configurado.'));
    }

    const built = this.buildAuthUrl();
    if (!built) {
      return Promise.reject(new Error('Google no está configurado.'));
    }

    const { url, csrf, nonce } = built;
    document.cookie = `${CSRF_COOKIE}=${csrf}; path=/; Max-Age=600; SameSite=Lax`;
    // El nonce viaja en el id_token; la página de vuelta lo valida contra este
    // valor para descartar tokens de intentos ajenos o viejos. Se guarda en
    // localStorage porque la vuelta ocurre en otra pestaña (sessionStorage es
    // por pestaña y no se comparte).
    localStorage.setItem(NONCE_KEY, nonce);
    // Limpia restos de una vuelta anterior que no se consumieron.
    localStorage.removeItem(RESULT_KEY);

    const left = Math.round((screen.availWidth - POPUP_W) / 2);
    const top = Math.round((screen.availHeight - POPUP_H) / 2);
    const win = window.open(
      url,
      'kmsplit_google',
      `width=${POPUP_W},height=${POPUP_H},left=${left},top=${top}`,
    );

    return new Promise<string>((resolve, reject) => {
      if (!win) {
        reject(
          new Error(
            'El navegador bloqueó la ventana de Google. Permití las ventanas emergentes e intentá de nuevo.',
          ),
        );
        return;
      }

      let settled = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearInterval(timer);
        if (timeout) clearTimeout(timeout);
        fn();
      };

      // La pestaña de vuelta deja la credencial en localStorage (mismo origen),
      // así funciona aunque hayamos perdido la referencia a la ventana.
      timer = setInterval(() => {
        const raw = localStorage.getItem(RESULT_KEY);
        if (raw) {
          localStorage.removeItem(RESULT_KEY);
          try {
            const credential = (JSON.parse(raw) as { credential: string }).credential;
            finish(() => resolve(credential));
          } catch {
            finish(() => reject(new Error('Google no respondió correctamente.')));
          }
        } else if (win.closed) {
          finish(() =>
            reject(new Error('El inicio de sesión con Google fue cancelado.')),
          );
        }
      }, 350);

      timeout = setTimeout(() => {
        finish(() =>
          reject(new Error('Google tardó demasiado en responder. Intentá de nuevo.')),
        );
      }, WAIT_MS);
    });
  }

  private buildAuthUrl(): { url: string; csrf: string; nonce: string } | null {
    const redirectUri = `${location.origin}/google/auth`;
    const csrf = randomToken();
    const nonce = randomToken();
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'id_token',
      scope: 'openid email profile',
      flowName: 'GeneralOAuthFlow',
      ux_mode: 'redirect',
      g_csrf_token: csrf,
      nonce,
    });
    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      csrf,
      nonce,
    };
  }
}