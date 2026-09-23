import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../environments/environment';
import { User } from '../models/user.model';
import { AuthService } from './auth.service';

const authUrl = `${environment.apiUrl}/auth`;
const ACCESS = 'kmsplit_access_token';
const REFRESH = 'kmsplit_refresh_token';

const user: User = {
  id: 1,
  name: 'Ana',
  first_name: '',
  last_name: '',
  avatar_url: '',
  email: 'ana@mail.com',
  created_at: '2026-01-01T00:00:00Z',
};

/** Arma un token JWT falso con el exp dado (segundos desde epoch). */
function jwt(expSec: number): string {
  const payload = btoa(JSON.stringify({ exp: expSec })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('login() hace POST y guarda los tokens', () => {
    service.login({ email: 'ana@mail.com', password: 'x' }).subscribe();
    const req = http.expectOne(`${authUrl}/login/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'ana@mail.com', password: 'x' });
    req.flush({ access: 'at', refresh: 'rt' });
    expect(localStorage.getItem(ACCESS)).toBe('at');
    expect(localStorage.getItem(REFRESH)).toBe('rt');
  });

  it('register() hace POST /register/', () => {
    service.register({ name: 'Ana', email: 'ana@mail.com', password: 'x' }).subscribe();
    const req = http.expectOne(`${authUrl}/register/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Ana', email: 'ana@mail.com', password: 'x' });
    req.flush(user);
  });

  it('fetchMe() cachea el usuario y no repite la request', () => {
    localStorage.setItem(ACCESS, 'at');
    service.fetchMe().subscribe((u) => expect(u.id).toBe(1));
    http.expectOne(`${authUrl}/me/`).flush(user);

    service.fetchMe().subscribe((u) => expect(u.id).toBe(1));
    expect(http.match(`${authUrl}/me/`)).toEqual([]);
  });

  it('fetchMe() comparte una sola request en vuelo entre llamadores en paralelo', () => {
    localStorage.setItem(ACCESS, 'at');
    const results: Array<User | undefined> = [];
    service.fetchMe().subscribe((u) => results.push(u));
    service.fetchMe().subscribe((u) => results.push(u));

    const reqs = http.match(`${authUrl}/me/`);
    expect(reqs.length).toBe(1);
    reqs[0].flush(user);
    expect(results).toEqual([user, user]);
  });

  it('getUserById() cachea por id', () => {
    service.getUserById(1).subscribe((u) => expect(u.id).toBe(1));
    http.expectOne(`${authUrl}/users/1/`).flush(user);

    service.getUserById(1).subscribe();
    expect(http.match(`${authUrl}/users/1/`)).toEqual([]);
  });

  it('updateProfile() hace PUT /me/ y refresca el usuario en memoria', () => {
    localStorage.setItem(ACCESS, 'at');
    service.fetchMe().subscribe();
    http.expectOne(`${authUrl}/me/`).flush(user);
    expect(service.getCurrentUser()).toEqual(user);

    service.updateProfile({ name: 'Ana', first_name: '', last_name: 'Lopez' }).subscribe();
    const req = http.expectOne(`${authUrl}/me/`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ name: 'Ana', first_name: '', last_name: 'Lopez' });
    req.flush({ ...user, last_name: 'Lopez' });
    expect(service.getCurrentUser()?.last_name).toBe('Lopez');
  });

  it('changePassword() hace POST /change-password/', () => {
    service
      .changePassword({ current_password: 'a', new_password: 'b', confirm_password: 'b' })
      .subscribe();
    const req = http.expectOne(`${authUrl}/change-password/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      current_password: 'a',
      new_password: 'b',
      confirm_password: 'b',
    });
    req.flush({ detail: 'Contraseña actualizada.' });
  });

  it('refresh() comparte la request entre llamadores paralelos y rota los tokens', () => {
    localStorage.setItem(REFRESH, 'rt');
    service.refresh().subscribe();
    service.refresh().subscribe();

    const reqs = http.match(`${authUrl}/refresh/`);
    expect(reqs.length).toBe(1);
    expect(reqs[0].request.body).toEqual({ refresh: 'rt' });
    reqs[0].flush({ access: 'at2', refresh: 'rt2' });
    expect(localStorage.getItem(ACCESS)).toBe('at2');
    expect(localStorage.getItem(REFRESH)).toBe('rt2');
  });

  it('logout() invalida en backend y limpia la sesión local', () => {
    localStorage.setItem(ACCESS, 'at');
    localStorage.setItem(REFRESH, 'rt');
    service.logout().subscribe();
    const req = http.expectOne(`${authUrl}/logout/`);
    expect(req.request.body).toEqual({ refresh: 'rt' });
    req.flush({});
    expect(localStorage.getItem(ACCESS)).toBeNull();
    expect(localStorage.getItem(REFRESH)).toBeNull();
    expect(service.getCurrentUser()).toBeNull();
  });

  it('logout() limpia la sesión local aunque el backend falle', () => {
    localStorage.setItem(ACCESS, 'at');
    localStorage.setItem(REFRESH, 'rt');
    service.logout().subscribe();
    const req = http.expectOne(`${authUrl}/logout/`);
    req.flush({ detail: 'invalid' }, { status: 400, statusText: 'Bad Request' });
    expect(localStorage.getItem(ACCESS)).toBeNull();
    expect(service.getCurrentUser()).toBeNull();
  });

  it('requestPasswordReset() hace POST /password-reset/request/', () => {
    service.requestPasswordReset({ email: 'ana@mail.com' }).subscribe();
    const req = http.expectOne(`${authUrl}/password-reset/request/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'ana@mail.com' });
    req.flush({ detail: 'ok' });
  });

  it('verifyPasswordResetCode() hace POST /password-reset/verify/', () => {
    service.verifyPasswordResetCode({ email: 'ana@mail.com', code: '1234' }).subscribe();
    const req = http.expectOne(`${authUrl}/password-reset/verify/`);
    expect(req.request.body).toEqual({ email: 'ana@mail.com', code: '1234' });
    req.flush({ valid: true });
  });

  it('confirmPasswordReset() hace POST /password-reset/confirm/', () => {
    service
      .confirmPasswordReset({ email: 'ana@mail.com', code: '1234', new_password: 'x', confirm_password: 'x' })
      .subscribe();
    const req = http.expectOne(`${authUrl}/password-reset/confirm/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      email: 'ana@mail.com',
      code: '1234',
      new_password: 'x',
      confirm_password: 'x',
    });
    req.flush({ detail: 'ok' });
  });

  it('isAccessTokenFresh(): sin token / vigente / vencido', () => {
    expect(service.isAccessTokenFresh()).toBe(false);

    localStorage.setItem(ACCESS, jwt(Math.floor(Date.now() / 1000) + 7200));
    expect(service.isAccessTokenFresh()).toBe(true);

    localStorage.setItem(ACCESS, jwt(Math.floor(Date.now() / 1000) - 60));
    expect(service.isAccessTokenFresh()).toBe(false);
  });
});