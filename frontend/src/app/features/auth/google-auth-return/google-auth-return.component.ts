import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

const RESULT_KEY = 'kmsplit_google_credential';
const NONCE_KEY = 'kmsplit_google_nonce';

/**
 * Ruta a la que Google redirige tras el login (`<origin>/google/auth`).
 * Lee el `#id_token` (flujo OAuth plano) o `#credential` (formato GIS) del
 * hash, verifica que el nonce del token coincida con el que enviamos en el
 * intento actual (descarta tokens de intentos ajenos o viejos), guarda la
 * credencial en `localStorage` para que el flujo original la consuma y
 * cierra la pestaña. Si vino sin credencial o el nonce no coincide, no
 * guarda nada y se limita a mostrar un aviso.
 */
@Component({
  selector: 'app-google-auth-return',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="screen">
      <h1 class="google-return-title">KmSplit</h1>
      <p class="muted">Procesando el inicio de sesión con Google...</p>
      <p class="muted google-return-hint">
        Si esta ventana no se cierra sola, podés cerrarla.
      </p>
    </div>
  `,
  styles: [
    `
      .google-return-title {
        text-align: center;
      }
      .google-return-hint {
        margin-top: 6px;
        font-size: 13px;
        text-align: center;
      }
    `,
  ],
})
export class GoogleAuthReturnComponent {
  constructor() {
    const params = new URLSearchParams(location.hash.slice(1));
    const credential = params.get('id_token') ?? params.get('credential');
    const expectedNonce = localStorage.getItem(NONCE_KEY);

    // El nonce se consume en esta vuelta.
    localStorage.removeItem(NONCE_KEY);

    const nonceOk =
      expectedNonce !== null && this.decodePayloadNonce(credential) === expectedNonce;

    if (credential && nonceOk) {
      localStorage.setItem(RESULT_KEY, JSON.stringify({ credential }));
      if (window.opener) {
        // Le damos un instante al flujo original para que lea el marker.
        setTimeout(() => window.close(), 400);
      }
    } else {
      // Vino sin credencial (entrada directa), o el nonce no coincide con el
      // intento: no completamos el login, solo informamos cómo cerrar.
    }
  }

  /** Lee el claim `nonce` del JWT (solo lo decodifica, no lo verifica: el
   *  backend es quien verifica la firma). Si no es un JWT, devuelve null. */
  private decodePayloadNonce(jwt: string | null): string | null {
    if (!jwt) return null;
    const part = jwt.split('.')[1];
    if (!part) return null;
    try {
      const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const payload = JSON.parse(
        decodeURIComponent(
          Array.from(atob(padded), (c) =>
            '%' + c.charCodeAt(0).toString(16).padStart(2, '0'),
          ).join(''),
        ),
      );
      return typeof payload.nonce === 'string' ? payload.nonce : null;
    } catch {
      return null;
    }
  }
}