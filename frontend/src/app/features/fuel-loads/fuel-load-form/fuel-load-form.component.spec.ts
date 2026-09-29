import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { FuelLoadFormComponent } from './fuel-load-form.component';



function paramMap(params: Record<string, string>) {
  return {
    get: (name: string) => params[name] ?? null,
    has: (name: string) => name in params,
    getAll: () => [],
    keys: Object.keys(params),
  };
}

describe('FuelLoadFormComponent (edición de fecha)', () => {
  let http: HttpTestingController;
  const params = { edit: '5', liquidacion: '9', from: 'historial' };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FuelLoadFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: paramMap({ id: '3' }), queryParamMap: paramMap(params) },
            queryParamMap: { subscribe: (fn: (p: unknown) => void) => fn(paramMap(params)) },
          },
        },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  /** Cierra las requests que dejan la campana y la lista de liquidaciones. */
  function drain(): void {
    for (const req of http.match(() => true)) {
      req.flush(req.request.url.includes('unread_count') ? { count: 0 } : []);
    }
  }

  it('el PATCH de guardar manda la fecha que se editó', () => {
    const fixture = TestBed.createComponent(FuelLoadFormComponent);
    fixture.detectChanges();

    const get = http.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/fuel-loads/5/'),
    );
    get.flush({
      id: 5,
      vehicle: 3,
      loaded_by: 1,
      load_date: '2026-07-02',
      odometer_km: 1100,
      amount: '5000.00',
      liters: null,
      created_at: '2026-07-02T10:00:00Z',
    });
    fixture.detectChanges();

    // el form quedó con la fecha de la carga
    expect(fixture.componentInstance.form.controls.load_date.value).toBe('2026-07-02');

    // el usuario cambia la fecha y guarda
    fixture.componentInstance.form.controls.load_date.setValue('2026-07-05');
    fixture.componentInstance.submit();

    const patch = http.expectOne(
      (r) => r.method === 'PATCH' && r.url.endsWith('/fuel-loads/5/'),
    );
    expect(patch.request.body).toEqual({
      load_date: '2026-07-05',
      odometer_km: 1100,
      amount: 5000,
      liters: null,
    });
    patch.flush({ id: 5, load_date: '2026-07-05', odometer_km: 1100, amount: '5000.00' });
    fixture.detectChanges();

    drain();
  });

  it('si la fecha queda vacía no hace nada en silencio: avisa qué falta', () => {
    const fixture = TestBed.createComponent(FuelLoadFormComponent);
    fixture.detectChanges();

    http
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/fuel-loads/5/'))
      .flush({
        id: 5,
        vehicle: 3,
        loaded_by: 1,
        load_date: '2026-07-02',
        odometer_km: 1100,
        amount: '5000.00',
        liters: null,
        created_at: '2026-07-02T10:00:00Z',
      });
    fixture.detectChanges();

    fixture.componentInstance.form.controls.load_date.setValue('');
    fixture.componentInstance.submit();
    fixture.detectChanges();

    http.expectNone((r) => r.method === 'PATCH');
    expect(fixture.componentInstance.errorMessage()).toBeTruthy();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Elegí la fecha de la carga.');

    drain();
  });
});
