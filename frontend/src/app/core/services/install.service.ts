import { Injectable, signal } from '@angular/core';

/** Evento no estándar de Chromium para el prompt nativo de instalación PWA. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Maneja la instalación de la PWA:
 * - Chrome/Edge/Android disparan `beforeinstallprompt`: guardamos el evento y
 *   lo mostramos cuando el usuario toca "Instalar app".
 * - iOS/Safari no tiene prompt: se le muestran las instrucciones de
 *   "Compartir → Agregar a inicio".
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  /** El navegador permitió mostrar el prompt nativo. */
  readonly canInstall = signal(false);
  /** La app ya se está ejecutando instalada (no en una pestaña). */
  readonly isInstalled = signal(this.detectStandalone());
  /** Es iPhone/iPad: hay que explicar el flujo manual. */
  readonly isIos = signal(this.detectIos());

  constructor() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
      this.isInstalled.set(true);
    });
  }

  /** Abre el prompt nativo. Devuelve true si el usuario aceptó. */
  async promptInstall(): Promise<boolean> {
    const prompt = this.deferredPrompt;
    if (!prompt) return false;

    await prompt.prompt();
    const choice = await prompt.userChoice;
    this.deferredPrompt = null;
    this.canInstall.set(false);
    return choice.outcome === 'accepted';
  }

  private detectStandalone(): boolean {
    const byMedia =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches;
    return (
      byMedia ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  }

  private detectIos(): boolean {
    const ua = navigator.userAgent;
    return (
      /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }
}
