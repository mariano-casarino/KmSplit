import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, catchError, finalize, of, shareReplay, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  AccessTokenResponse,
  ChangePasswordRequest,
  LoginRequest,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  PasswordResetVerifyRequest,
  ProfileUpdateRequest,
  RegisterRequest,
} from '../models/auth.model';
import { User } from '../models/user.model';
import { retryTransient } from '../../shared/utils/retry-transient.util';

const ACCESS_TOKEN_KEY = 'kmsplit_access_token';
const REFRESH_TOKEN_KEY = 'kmsplit_refresh_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/auth`;

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  /** Refresco compartido: si ya hay uno en vuelo (petición http que no recibió respuesta),
      todos los llamadores (interceptor ante varios 401 paralelos, guard, etc.) esperan el mismo.
   *  Evita que la rotación invalide tokens entre sí y cierre la sesión. */
  private refreshRequest: Observable<AccessTokenResponse> | null = null;

  /** fetchMe() compartido: evita disparar /auth/me en cada pantalla cuando
   *  ya está en vuelo (varios componentes montando a la vez). */
  private fetchMeRequest: Observable<User> | null = null;

  /** Cache simple para usuarios por ID (evita requests repetidos). */
  private userCache = new Map<number, User>();

  get accessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  /** True si el access token sigue vigente por al menos ~30 min.
   *  Sirve para evitar refrescar en cada navegación (el refresh rota el
   *  token y dispara escrituras de cookie). */
  isAccessTokenFresh(): boolean {
    const token = this.accessToken;
    if (!token) return false;
    try {
      const payload = JSON.parse(
        atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
      );
      const expiresInMs = (payload.exp as number) * 1000 - Date.now();
      return expiresInMs > 30 * 60 * 1000;
    } catch {
      return false;
    }
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.getValue();
  }

  login(payload: LoginRequest): Observable<AccessTokenResponse> {
    return this.http
      .post<AccessTokenResponse>(`${this.baseUrl}/login/`, payload)
      .pipe(
        tap(({ access, refresh }) => {
          localStorage.setItem(ACCESS_TOKEN_KEY, access);
          if (refresh) localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
        }),
      );
  }

  register(payload: RegisterRequest): Observable<User> {
    return this.http.post<User>(`${this.baseUrl}/register/`, payload);
  }

  /**
   * Devuelve el usuario actual. Solo hace GET /auth/me cuando hace falta:
   * reutiliza el usuario cacheado mientras la sesión esté activa y comparte
   * una sola request si varios componentes lo piden a la vez.
   */
  fetchMe(): Observable<User> {
    const cached = this.currentUserSubject.getValue();
    if (cached && this.isAuthenticated()) {
      return of(cached);
    }
    // Comparte la request en vuelo: si varios componentes montan a la vez
    // (guards, headers, vistas), todos esperan el mismo /auth/me.
    if (!this.fetchMeRequest) {
      this.fetchMeRequest = this.http.get<User>(`${this.baseUrl}/me/`).pipe(
        tap((user) => this.currentUserSubject.next(user)),
        finalize(() => (this.fetchMeRequest = null)),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
    }
    return this.fetchMeRequest;
  }

  /** Obtiene un usuario por ID (usa cache simple para evitar requests repetidos). */
  getUserById(id: number): Observable<User> {
    const cached = this.userCache.get(id);
    if (cached) {
      return of(cached);
    }
    return this.http.get<User>(`${this.baseUrl}/users/${id}/`).pipe(
      tap((user) => this.userCache.set(id, user)),
    );
  }

  /** Renueva la sesión.  Intenta: cookie httpOnly (primario) → body
   *  (respaldo para iOS PWA donde la cookie se limpia al relanzar la app).
   *  El refresh token nuevo se almacena en AMBOS (cookie + localStorage). */
  refresh(): Observable<AccessTokenResponse> {
    if (!this.refreshRequest) {
      // El body solo se usa si la cookie falta (backend lo ignora si la cookie existe).
      const body: Record<string, string> = {};
      const stored = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (stored) body['refresh'] = stored;

      this.refreshRequest = this.http
        .post<AccessTokenResponse>(`${this.baseUrl}/refresh/`, body)
        .pipe(
          retryTransient(3),
          tap(({ access, refresh }) => {
            localStorage.setItem(ACCESS_TOKEN_KEY, access);
            if (refresh) localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
          }),
          finalize(() => (this.refreshRequest = null)),
          shareReplay({ bufferSize: 1, refCount: true }),
        );
    }
    return this.refreshRequest;
  }

  logout(): Observable<unknown> {
    // Enviar refresh en el body para que el backend lo invalide (blacklist)
    // incluso si la cookie httpOnly fue limpiada (iOS PWA).
    const body: Record<string, string> = {};
    const stored = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (stored) body['refresh'] = stored;

    return this.http.post(`${this.baseUrl}/logout/`, body).pipe(
      tap(() => this.clearLocalSession()),
      catchError(() => {
        this.clearLocalSession();
        return of(null);
      }),
    );
  }

  requestPasswordReset(payload: PasswordResetRequest): Observable<{ detail: string }> {
    return this.http.post<{ detail: string }>(`${this.baseUrl}/password-reset/request/`, payload);
  }

  verifyPasswordResetCode(payload: PasswordResetVerifyRequest): Observable<{ valid: boolean }> {
    return this.http.post<{ valid: boolean }>(`${this.baseUrl}/password-reset/verify/`, payload);
  }

  confirmPasswordReset(payload: PasswordResetConfirmRequest): Observable<{ detail: string }> {
    return this.http.post<{ detail: string }>(`${this.baseUrl}/password-reset/confirm/`, payload);
  }

  /** PUT /auth/me/ — actualiza apodo (name) y apellido (last_name). El email
   *  es de solo lectura en el backend; el usuario cacheado se refresca. */
  updateProfile(payload: ProfileUpdateRequest): Observable<User> {
    return this.http.put<User>(`${this.baseUrl}/me/`, payload).pipe(
      tap((user) => this.currentUserSubject.next(user)),
    );
  }

  /** POST /auth/change-password/ — cambia la contraseña del usuario logueado. */
  changePassword(payload: ChangePasswordRequest): Observable<{ detail: string }> {
    return this.http.post<{ detail: string }>(`${this.baseUrl}/change-password/`, payload);
  }

  private clearLocalSession(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    this.currentUserSubject.next(null);
  }
}