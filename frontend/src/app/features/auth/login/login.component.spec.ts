import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../../environments/environment';
import { GoogleAuthService } from '../../../core/services/google-auth.service';
import { LoginComponent } from './login.component';

const authUrl = `${environment.apiUrl}/auth`;
const groupsUrl = `${environment.apiUrl}/groups`;
const vehiclesUrl = `${environment.apiUrl}/vehicles`;

const USER = {
  id: 1,
  name: 'Ana',
  first_name: 'Ana',
  last_name: '',
  avatar_url: '',
  email: 'ana@mail.com',
  created_at: '2026-01-01T00:00:00Z',
};

const GROUP = {
  id: 1,
  name: 'Familia',
  avatar_url: '',
  invite_code: 'ABC123',
  created_by: 1,
  created_at: '2026-01-01T00:00:00Z',
  members: [],
};

const VEHICLE = {
  id: 3,
  group: 1,
  name: 'Gol',
  fuel_type: 'nafta',
  photo_url: '',
  current_km: 1100,
  split_unassigned_km_all_members: false,
  created_at: '2026-01-01T00:00:00Z',
};

describe('LoginComponent (el botón de Google no parpadea)', () => {
  let http: HttpTestingController;
  let router: Router;
  let signIn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    localStorage.clear();
    signIn = vi.fn().mockResolvedValue('credencial-falsa');

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: GoogleAuthService, useValue: { enabled: true, clientId: 'x', signIn } },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('sigue en "Ingresando con Google..." hasta que la navegación ocurre', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const vm = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    const button = el.querySelector('.btn-google') as HTMLButtonElement;

    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    vm.loginWithGoogle();
    fixture.detectChanges();
    expect(button.textContent).toContain('Ingresando con Google...');
    expect(button.disabled).toBe(true);

    // Google responde: POST /auth/google/
    await Promise.resolve();
    http.expectOne(`${authUrl}/google/`).flush({ access: 'at', refresh: 'rt' });

    // GET /auth/me/
    http.expectOne(`${authUrl}/me/`).flush(USER);

    // La app ya está adentro, pero todavía está reanudando (grupos + vehículos).
    const groups = http.expectOne(`${groupsUrl}/`);
    fixture.detectChanges();

    // La regresión: antes de este fix el botón volvía a su texto inicial y
    // parecía que el login había fallado.
    expect(button.textContent).toContain('Ingresando con Google...');
    expect(button.textContent).not.toContain('Continuar con Google');
    expect(button.disabled).toBe(true);
    expect(navigate).not.toHaveBeenCalled();

    groups.flush([GROUP]);
    http.expectOne(`${vehiclesUrl}/`).flush([VEHICLE]);

    // Sin "último vehículo" guardado, la reanudación va al selector.
    expect(navigate).toHaveBeenCalledWith(['/vehiculos']);
  });

  it('el login por email tampoco destraba el botón antes de navegar', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const vm = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    const submit = el.querySelector('button[type="submit"]') as HTMLButtonElement;

    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    vm.form.controls.email.setValue('ana@mail.com');
    vm.form.controls.password.setValue('clave');
    vm.submit();
    fixture.detectChanges();
    expect(submit.textContent).toContain('Ingresando...');

    http.expectOne(`${authUrl}/login/`).flush({ access: 'at', refresh: 'rt' });
    http.expectOne(`${authUrl}/me/`).flush(USER);

    const groups = http.expectOne(`${groupsUrl}/`);
    fixture.detectChanges();
    expect(submit.textContent).toContain('Ingresando...');
    expect(submit.disabled).toBe(true);

    groups.flush([GROUP]);
    http.expectOne(`${vehiclesUrl}/`).flush([VEHICLE]);
    expect(navigate).toHaveBeenCalledWith(['/vehiculos']);
  });

  it('si Google falla, vuelve el botón y muestra el error', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const vm = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    const button = el.querySelector('.btn-google') as HTMLButtonElement;

    vm.loginWithGoogle();
    await Promise.resolve();
    http
      .expectOne(`${authUrl}/google/`)
      .flush({ detail: 'No pudimos iniciar sesión con Google.' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();

    expect(vm.googleLoading()).toBe(false);
    expect(vm.googleError()).toBe('No pudimos iniciar sesión con Google.');
    expect(button.textContent).toContain('Continuar con Google');
    expect(button.disabled).toBe(false);
  });

  it('si el usuario cancela el popup, se destraba sin dejar el formulario colgado', async () => {
    signIn.mockRejectedValue(new Error('El inicio de sesión con Google fue cancelado.'));

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const vm = fixture.componentInstance;

    vm.loginWithGoogle();
    await Promise.resolve();
    fixture.detectChanges();

    expect(vm.googleLoading()).toBe(false);
    expect(vm.loading()).toBe(false);
    expect(vm.googleError()).toBe('El inicio de sesión con Google fue cancelado.');
  });

  it('si la navegación falla, destraba para que se pueda reintentar', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const vm = fixture.componentInstance;
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      '.btn-google',
    ) as HTMLButtonElement;

    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(false);

    vm.loginWithGoogle();
    await Promise.resolve();
    http.expectOne(`${authUrl}/google/`).flush({ access: 'at', refresh: 'rt' });
    http.expectOne(`${authUrl}/me/`).flush(USER);
    http.expectOne(`${groupsUrl}/`).flush([]);
    await Promise.resolve();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalled();
    expect(vm.googleLoading()).toBe(false);
    expect(button.textContent).toContain('Continuar con Google');
  });
});
