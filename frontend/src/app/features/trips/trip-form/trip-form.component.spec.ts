import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TripFormComponent } from './trip-form.component';

const TRIP = {
  id: 7,
  vehicle: 3,
  user: 1,
  user_name: 'Yo',
  trip_date: '2026-07-02',
  start_km: 1000,
  end_km: 1100,
  km_traveled: 100,
  notes: '',
  created_at: '2026-07-02T10:00:00Z',
};

const VEHICLE = {
  id: 3,
  name: 'Gol',
  current_km: 1100,
  year: 2020,
  color: 'blanco',
  active: true,
};

function paramMap(params: Record<string, string>) {
  return {
    get: (name: string) => params[name] ?? null,
    has: (name: string) => name in params,
    getAll: () => [],
    keys: Object.keys(params),
  };
}

describe('TripFormComponent (confirmación del cambio)', () => {
  let http: HttpTestingController;
  let router: Router;
  let params: Record<string, string>;

  beforeEach(async () => {
    params = { tripId: '7', returnTo: 'full' };

    await TestBed.configureTestingModule({
      imports: [TripFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: paramMap({ id: '3' }),
              get queryParamMap() {
                return paramMap(params);
              },
            },
          },
        },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Cierra el contexto inicial (yo, vehículo, viajes) y la campana. */
  function loadContext(): void {
    for (const req of http.match(() => true)) {
      const url = req.request.url;
      if (url.includes('/auth/me/')) {
        req.flush({ id: 1, name: 'Yo', email: 'yo@test.com', is_admin: false });
      } else if (url.includes('/vehicles/')) {
        req.flush(VEHICLE);
      } else if (url.includes('/trips/')) {
        req.flush([TRIP]);
      } else {
        req.flush({ count: 0 });
      }
    }
  }

  it('tras editar un viaje el botón se pone verde 1s y recién ahí vuelve al historial', () => {
    const fixture = TestBed.createComponent(TripFormComponent);
    fixture.detectChanges();
    loadContext();
    fixture.detectChanges();

    const vm = fixture.componentInstance;
    expect(vm.editingTripId()).toBe(7);
    expect(fixture.nativeElement.textContent).toContain('Confirmar cambio');

    vi.useFakeTimers();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    vm.form.controls.trip_date.setValue('2026-07-05');
    vm.submit();

    const patch = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/trips/7/'));
    expect(patch.request.body).toEqual({
      trip_date: '2026-07-05',
      start_km: 1000,
      end_km: 1100,
    });
    patch.flush({ ...TRIP, trip_date: '2026-07-05' });
    fixture.detectChanges();

    // el botón confirma el cambio y todavía no se volvió
    expect(vm.saveSuccess()).toBe(true);
    const button = (fixture.nativeElement as HTMLElement).querySelector('button[type="submit"]');
    expect(button?.textContent).toContain('Cambio guardado');
    expect(button?.classList).toContain('btn-success');
    expect(navigate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(navigate).toHaveBeenCalledWith(['/vehiculo', 3, 'historial']);
  });

  it('al registrar un viaje nuevo no frena: vuelve enseguida', () => {
    params = {};
    const fixture = TestBed.createComponent(TripFormComponent);
    fixture.detectChanges();
    loadContext();
    fixture.detectChanges();

    const vm = fixture.componentInstance;
    expect(vm.editingTripId()).toBeNull();

    vi.useFakeTimers();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    // atajo de km: 3 dígitos a partir del km actual
    vm.form.controls.end_km_shortcut.setValue('100');

    vm.submit();

    const post = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/trips/'));
    post.flush(TRIP);
    fixture.detectChanges();

    expect(vm.saveSuccess()).toBe(false);
    expect(navigate).toHaveBeenCalled();
  });
});
