import { describe, expect, it, vi } from 'vitest';

import {
  createFlashHighlight,
  highlightRequestFor,
  idsWithUnregisteredGap,
  notificationTarget,
  parseHighlightRequest,
  recordKey,
  recordViewSegments,
  recordViewToOpen,
  resolveHighlightKey,
  HIGHLIGHT_FLASH_MS,
} from './records';

describe('recordKey', () => {
  it('arma la clave con tipo y id', () => {
    expect(recordKey('trip', 12)).toBe('trip-12');
    expect(recordKey('fuel', 7)).toBe('fuel-7');
  });
});

describe('idsWithUnregisteredGap', () => {
  it('no marca nada cuando los tramos son continuos', () => {
    const ids = idsWithUnregisteredGap([
      { id: 'trip-2', minKm: 1000, maxKm: 1045 },
      { id: 'trip-1', minKm: 955, maxKm: 1000 },
      { id: 'trip-0', minKm: 900, maxKm: 955 },
    ]);
    expect(ids.size).toBe(0);
  });

  it('marca el registro cuyo separador inferior tiene un bache', () => {
    const ids = idsWithUnregisteredGap([
      { id: 'trip-2', minKm: 1000, maxKm: 1045 },
      // entre 1000 y 800 nadie anotó nada
      { id: 'trip-1', minKm: 800, maxKm: 800 },
    ]);
    expect([...ids]).toEqual(['trip-2']);
  });

  it('detecta el bache también cuando la carga parte en un punto medio', () => {
    const ids = idsWithUnregisteredGap([
      { id: 'fuel-9', minKm: 1100, maxKm: 1100 },
      { id: 'trip-2', minKm: 1000, maxKm: 1045 },
    ]);
    expect([...ids]).toEqual(['fuel-9']);
  });

  it('ordena los registros por km aunque vengan desordenados', () => {
    const ids = idsWithUnregisteredGap([
      { id: 'trip-1', minKm: 800, maxKm: 800 },
      { id: 'trip-2', minKm: 1000, maxKm: 1045 },
    ]);
    expect([...ids]).toEqual(['trip-2']);
  });

  it('ignora el ruido de redondeo', () => {
    const ids = idsWithUnregisteredGap([
      { id: 'trip-1', minKm: 1000, maxKm: 1045 },
      { id: 'trip-0', minKm: 999.8, maxKm: 1000 },
    ]);
    expect(ids.size).toBe(0);
  });

  it('con un solo registro no hay separadores que marcar', () => {
    const ids = idsWithUnregisteredGap([{ id: 'trip-1', minKm: 1000, maxKm: 1045 }]);
    expect(ids.size).toBe(0);
  });
});

describe('notificationTarget', () => {
  const now = new Date('2026-09-27T12:00:00Z');

  it('con record_id va al resumen pidiendo el resaltado del registro', () => {
    const target = notificationTarget({
      vehicleId: 3,
      kind: 'trip',
      recordId: 12,
      createdAt: '2026-09-27T10:00:00Z',
      now,
    });
    expect(target).toEqual({
      segments: ['/vehiculo', 3, 'resumen'],
      view: 'resumen',
      highlight: 'trip-12',
    });
  });

  it('sin record_id pero reciente va a los últimos 7 días (no al historial)', () => {
    const target = notificationTarget({
      vehicleId: 3,
      kind: 'fuel',
      recordId: null,
      createdAt: '2026-09-25T10:00:00Z',
      now,
    });
    expect(target).toEqual({
      segments: ['/vehiculo', 3, 'historial', 'semana'],
      view: 'week',
      highlight: 'kind:fuel@2026-09-25',
    });
  });

  it('sin record_id y vieja va al historial completo', () => {
    const target = notificationTarget({
      vehicleId: 3,
      kind: 'fuel',
      recordId: null,
      createdAt: '2026-09-01T10:00:00Z',
      now,
    });
    expect(target).toEqual({
      segments: ['/vehiculo', 3, 'historial'],
      view: 'full',
      highlight: 'kind:fuel@2026-09-01',
    });
  });

  it('sin vehículo no inventa ruta (el que llama usa el link)', () => {
    expect(
      notificationTarget({
        vehicleId: null,
        kind: 'trip',
        recordId: 12,
        createdAt: '2026-09-27T10:00:00Z',
        now,
      }),
    ).toBeNull();
  });
});

describe('resaltado de notificaciones sin record_id', () => {
  const registros = [
    { id: 'fuel-9', type: 'fuel' as const, date: '2026-09-26' },
    { id: 'trip-8', type: 'trip' as const, date: '2026-09-25' },
    { id: 'fuel-7', type: 'fuel' as const, date: '2026-09-24' },
    { id: 'trip-6', type: 'trip' as const, date: '2026-09-20' },
  ];

  it('con record_id pide ese registro exacto', () => {
    const raw = highlightRequestFor({ kind: 'trip', recordId: 12, createdAt: '2026-09-27T10:00:00Z' });
    expect(raw).toBe('trip-12');
    expect(parseHighlightRequest(raw)).toEqual({ mode: 'record', key: 'trip-12' });
  });

  it('sin record_id pide "el de ese tipo más reciente a la fecha del aviso"', () => {
    const raw = highlightRequestFor({ kind: 'trip', recordId: null, createdAt: '2026-09-25T18:00:00Z' });
    expect(raw).toBe('kind:trip@2026-09-25');
    expect(parseHighlightRequest(raw)).toEqual({
      mode: 'latest-of-kind',
      recordKind: 'trip',
      onDate: '2026-09-25',
    });
  });

  it('resuelve el registro de ese tipo más reciente que ya existía', () => {
    const request = parseHighlightRequest('kind:trip@2026-09-25');
    // hay dos viajes: gana el del 25 (el del 20 es más viejo)
    expect(resolveHighlightKey(request!, registros)).toBe('trip-8');
  });

  it('ignora los registros que se crearon después del aviso', () => {
    const request = parseHighlightRequest('kind:trip@2026-09-21');
    expect(resolveHighlightKey(request!, registros)).toBe('trip-6');
  });

  it('devuelve null si en esa lista no hay nada de ese tipo (hay que bajarse)', () => {
    const request = parseHighlightRequest('kind:fuel@2026-09-01');
    expect(resolveHighlightKey(request!, registros)).toBeNull();
  });

  it('un registro exacto que no está en la lista tampoco resuelve (hay que bajarse)', () => {
    const request = parseHighlightRequest('trip-99');
    expect(resolveHighlightKey(request!, registros)).toBeNull();
  });

  it('un request de tipo desconocido no resuelve', () => {
    expect(parseHighlightRequest('kind:otro@2026-09-25')).toBeNull();
    expect(parseHighlightRequest('')).toBeNull();
    expect(parseHighlightRequest(null)).toBeNull();
  });

  it('la cascada de 7 días al historial completo también usa el request original', () => {
    // en 7 días no hay viajes (el aviso es de un viaje viejo): se baja al
    // historial completo y ahí sí aparece
    const request = parseHighlightRequest('kind:trip@2026-09-20');
    const enSemana = registros.filter(
      (r) => r.type === 'trip' && r.date >= '2026-09-20' && r.date <= '2026-09-27',
    );
    expect(resolveHighlightKey(request!, enSemana)).toBe('trip-6');
    expect(recordViewToOpen('week', false)).toBe('full');
  });
});

describe('recordViewToOpen', () => {
  it('si el registro está a la vista, no se cambia de pantalla', () => {
    expect(recordViewToOpen('resumen', true)).toBe('resumen');
    expect(recordViewToOpen('week', true)).toBe('week');
    expect(recordViewToOpen('full', true)).toBe('full');
  });

  it('el resumen baja a los últimos 7 días', () => {
    expect(recordViewToOpen('resumen', false)).toBe('week');
  });

  it('los últimos 7 días bajan al historial completo', () => {
    expect(recordViewToOpen('week', false)).toBe('full');
  });

  it('el historial completo es el último escalón: no hay a dónde más ir', () => {
    expect(recordViewToOpen('full', false)).toBe('full');
  });

  it('las rutas de cada vista', () => {
    expect(recordViewSegments(3, 'resumen')).toEqual(['/vehiculo', 3, 'resumen']);
    expect(recordViewSegments(3, 'week')).toEqual(['/vehiculo', 3, 'historial', 'semana']);
    expect(recordViewSegments(3, 'full')).toEqual(['/vehiculo', 3, 'historial']);
  });
});

describe('createFlashHighlight', () => {
  it('enciende el resalte y lo apaga solo', () => {
    vi.useFakeTimers();
    const { highlightedKey, flash } = createFlashHighlight();

    flash('trip-12');
    vi.advanceTimersByTime(0);
    expect(highlightedKey()).toBe('trip-12');

    vi.advanceTimersByTime(HIGHLIGHT_FLASH_MS);
    expect(highlightedKey()).toBeNull();

    vi.useRealTimers();
  });

  it('tocar otra notificación mueve el resalte de una fila a la otra', () => {
    vi.useFakeTimers();
    const { highlightedKey, flash } = createFlashHighlight();

    flash('trip-12');
    vi.advanceTimersByTime(0);
    expect(highlightedKey()).toBe('trip-12');

    flash('fuel-7');
    vi.advanceTimersByTime(0);
    expect(highlightedKey()).toBe('fuel-7');

    // el timer del primero no lo deja prendido
    vi.advanceTimersByTime(HIGHLIGHT_FLASH_MS);
    expect(highlightedKey()).toBeNull();

    vi.useRealTimers();
  });

  it('clear() corta el resalte al instante', () => {
    vi.useFakeTimers();
    const { highlightedKey, flash, clear } = createFlashHighlight();

    flash('trip-12');
    vi.advanceTimersByTime(0);
    expect(highlightedKey()).toBe('trip-12');

    clear();
    expect(highlightedKey()).toBeNull();

    vi.advanceTimersByTime(HIGHLIGHT_FLASH_MS * 2);
    expect(highlightedKey()).toBeNull();

    vi.useRealTimers();
  });

  it('onDone se dispara al apagarse solo, pero no al cortar con clear()', () => {
    vi.useFakeTimers();
    let done = 0;
    const { flash, clear } = createFlashHighlight(() => done++);

    flash('trip-12');
    vi.advanceTimersByTime(HIGHLIGHT_FLASH_MS);
    expect(done).toBe(1);

    flash('fuel-7');
    clear();
    vi.advanceTimersByTime(HIGHLIGHT_FLASH_MS * 3);
    expect(done).toBe(1);

    vi.useRealTimers();
  });
});
