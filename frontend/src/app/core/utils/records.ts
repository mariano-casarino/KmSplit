/**
 * Utilidades compartidas por el resumen, el historial y la campana para hablar
 * de "registros" (viajes y cargas) de forma consistente.
 *
 * Un registro se identifica con una clave de texto (`trip-12`, `fuel-7`) que
 * es la misma dentro de las listas de las pantallas y la que se pasa por query
 * param (?highlight=trip-12) para abrir y resaltar uno puntual.
 */
import { signal, Signal } from '@angular/core';

export type RecordKind = 'trip' | 'fuel';

/** Cuánto dura el resaltado al llegar desde una notificación. Es una señal
 *  para que llame la atención, no un estado permanente. */
export const HIGHLIGHT_FLASH_MS = 1000;

/** Clave estable de un registro, para matchear y para mandar por query param. */
export function recordKey(kind: RecordKind, id: number): string {
  return `${kind}-${id}`;
}

/** Un registroexpressed como tramo de km que ocupa. */
export interface RecordKmRange {
  id: string;
  /** Km más bajo que ocupa (inicio del viaje / odómetro de la carga). */
  minKm: number;
  /** Km más alto que ocupa (fin del viaje / odómetro de la carga). */
  maxKm: number;
}

/** Tolerancia para no marcar ruido de redondeo como "hueco". */
const GAP_TOLERANCE_KM = 0.5;

/**
 * Devuelve el Set de ids cuyo separador inferior (la línea que lo divide del
 * registro siguiente) tiene kilómetros sin registrar: cuando el registro de
 * arriba empieza en un km más alto del que termina el de abajo, ese tramo
 * intermedio es km que nadie anotó.
 *
 * Los puntos llegan en cualquier orden: se ordenan de mayor a menor km, que es
 * como los muestran el resumen y el historial.
 */
export function idsWithUnregisteredGap(ranges: RecordKmRange[]): Set<string> {
  const sorted = [...ranges].sort((a, b) => b.minKm - a.minKm);
  const ids = new Set<string>();

  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].minKm - sorted[i + 1].maxKm > GAP_TOLERANCE_KM) {
      ids.add(sorted[i].id);
    }
  }

  return ids;
}

/* ------------------------------------------------------------------ *
 * Navegación desde una notificación
 * ------------------------------------------------------------------ */

/** Las tres listas donde puede vivir un registro, de más reciente a más
 *  vieja. El orden importa: es la cascada que se prueba en `recordViewToOpen`. */
export type RecordView = 'resumen' | 'week' | 'full';

export interface NotificationTarget {
  /** Segmentos de la ruta (con barra inicial) a la que navegar. */
  segments: (string | number)[];
  /** Vista de la que se trata: la usa la pantalla para decidir si se baja. */
  view: RecordView;
  /** Qué resaltar en esa vista (ver `highlightRequestFor`), o null si no se
   *  puede saber. */
  highlight: string | null;
}

/** Días que cubre la vista de "últimos 7 días". */
const WEEK_DAYS = 7;

/** Lo que se pidió resaltar al llegar desde una notificación.
 *
 *  - `record`: el registro exacto (notificaciones nuevas, que traen record_id).
 *  - `latest-of-kind`: el registro de ese tipo más reciente que existía cuando
 *    se generó la notificación (notificaciones viejas, que no traen record_id).
 *    Es la mejor aproximación posible: si al menos un registro de ese tipo no
 *    se volvió a tocar después, es exactamente el que generó el aviso. */
export type HighlightRequest =
  | { mode: 'record'; key: string }
  | { mode: 'latest-of-kind'; recordKind: RecordKind; onDate: string };

/** Lo mínimo de un registro que hace falta para resolver un resaltado. */
export interface HighlightableRecord {
  id: string;
  type: RecordKind;
  /** Fecha del registro en formato YYYY-MM-DD. */
  date: string;
}

/**
 * Arma el query param de resaltado de una notificación.
 *
 * Con `record_id` va el registro exacto. Sin `record_id` (notificaciones
 * anteriores a esa columna) se pide "el registro de ese tipo más reciente a la
 * fecha del aviso", que es lo que las listas de 7 días / historial pueden
 * resolver para que el resalte también exista ahí.
 */
export function highlightRequestFor(notification: {
  kind: RecordKind;
  recordId: number | null;
  createdAt: string;
}): string {
  if (notification.recordId !== null) {
    return recordKey(notification.kind, notification.recordId);
  }
  const onDate = notification.createdAt.slice(0, 10);
  return `kind:${notification.kind}@${onDate}`;
}

/** Interpreta el query param de resaltado. Devuelve null si no hay o si no tiene
 *  un formato conocido. */
export function parseHighlightRequest(raw: string | null): HighlightRequest | null {
  if (!raw) return null;

  if (raw.startsWith('kind:')) {
    const [kind, onDate] = raw.slice('kind:'.length).split('@');
    if ((kind === 'trip' || kind === 'fuel') && onDate) {
      return { mode: 'latest-of-kind', recordKind: kind, onDate };
    }
    return null;
  }

  return { mode: 'record', key: raw };
}

/**
 * Traduce lo que se pidió resaltar a la clave de una fila de la lista, o null
 * si en esta lista no está (y entonces hay que bajarse a la vista siguiente).
 *
 * La lista llega como se muestra en pantalla: de más nuevo a más viejo.
 */
export function resolveHighlightKey(
  request: HighlightRequest,
  records: readonly HighlightableRecord[],
): string | null {
  if (request.mode === 'record') {
    return records.some((r) => r.id === request.key) ? request.key : null;
  }

  const { recordKind, onDate } = request;
  let best: HighlightableRecord | null = null;
  for (const record of records) {
    if (record.type !== recordKind) continue;
    if (record.date > onDate) continue;
    // a igualdad de fecha gana el primero (la lista ya viene ordenada)
    if (!best || record.date > best.date) best = record;
  }
  return best ? best.id : null;
}

/**
 * A dónde hay que ir al tocar una notificación.
 *
 * - Con `record_id` (notificaciones nuevas) sabemos el registro exacto:
 *   arrancamos por el resumen, que es donde están los últimos, y cada vista
 *   se va bajando con `recordViewToOpen` si el registro no está a la vista.
 * - Sin `record_id` (notificaciones anteriores a esa columna) no sabemos qué
 *   registro es: vamos a la lista de registros. Si el aviso es de los últimos
 *   7 días vamos a "últimos 7 días"; si es más viejo, al historial completo.
 *   Antes siempre terminaba en el historial completo. En los dos casos se pide
 *   resaltar el registro de ese tipo más reciente a la fecha del aviso, así
 *   que el resalte también aparece en esas dos vistas.
 * - Sin vehículo no se puede armar la ruta: el que llama usa `link`.
 */
export function notificationTarget(input: {
  vehicleId: number | null;
  kind: RecordKind;
  recordId: number | null;
  createdAt: string;
  now?: Date;
}): NotificationTarget | null {
  const { vehicleId, kind, recordId, createdAt, now } = input;
  if (vehicleId === null) return null;

  const base = ['/vehiculo', vehicleId];
  const highlight = highlightRequestFor({ kind, recordId, createdAt });

  if (recordId !== null) {
    return { segments: [...base, 'resumen'], view: 'resumen', highlight };
  }

  const created = new Date(createdAt).getTime();
  const ageMs = (now?.getTime() ?? Date.now()) - created;
  const isRecent = Number.isFinite(ageMs) && ageMs <= WEEK_DAYS * 86_400_000;

  return isRecent
    ? { segments: [...base, 'historial', 'semana'], view: 'week', highlight }
    : { segments: [...base, 'historial'], view: 'full', highlight };
}

/**
 * Cascada: si el registro no está a la vista de la pantalla actual, a cuál hay
 * que caer. El historial completo es el último escalón (si tampoco está, no hay
 * a dónde ir: el registro fue borrado).
 */
export function recordViewToOpen(current: RecordView, isVisible: boolean): RecordView {
  if (isVisible) return current;
  if (current === 'resumen') return 'week';
  return 'full';
}

/** Ruta de una vista de registros. */
export function recordViewSegments(vehicleId: number, view: RecordView): (string | number)[] {
  const base = ['/vehiculo', vehicleId];
  if (view === 'resumen') return [...base, 'resumen'];
  if (view === 'week') return [...base, 'historial', 'semana'];
  return [...base, 'historial'];
}

/* ------------------------------------------------------------------ *
 * Resaltado temporal
 * ------------------------------------------------------------------ */

export interface FlashHighlight {
  /** Clave del registro que está resaltado ahora (null si ninguno). */
  highlightedKey: Signal<string | null>;
  /** Resalta la fila y saca el resaltado solo a los ~1s. */
  flash: (key: string) => void;
  /** Corta el resaltado (para cuando la pantalla se va). */
  clear: () => void;
}

/**
 * Resaltado "flash": al tocar una notificación la fila se ilumina para que se
 * note, y a los ~1s vuelve a su color. Cada `flash` reinicia el timer, así
 * que tocar dos notificaciones seguidas mueve el resaltado de una a otra.
 *
 * `onDone` se dispara cuando el resaltado se apaga solo (no cuando se corta
 * con `clear`): lo usan las pantallas para sacarse el `?highlight` de la URL,
 * de modo que tocar dos veces la misma notificación vuelva a encenderlo.
 */
export function createFlashHighlight(
  onDone?: () => void,
  durationMs = HIGHLIGHT_FLASH_MS,
): FlashHighlight {
  const highlightedKey = signal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    highlightedKey.set(null);
  };

  const flash = (key: string): void => {
    if (timer) clearTimeout(timer);
    // se apaga un tick para que, si se toca dos veces la misma fila, la
    // transición de color se reinicie en vez de quedarse pegada
    highlightedKey.set(null);
    timer = setTimeout(() => {
      highlightedKey.set(key);
      timer = setTimeout(() => {
        highlightedKey.set(null);
        timer = null;
        onDone?.();
      }, durationMs);
    });
  };

  return { highlightedKey: highlightedKey.asReadonly(), flash, clear };
}