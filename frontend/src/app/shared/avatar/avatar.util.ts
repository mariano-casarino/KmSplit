/**
 * Utilidades puras para el avatar compartido (iniciales + color determinístico).
 * Se usan en usuarios, vehículos y grupos: un solo lugar para el estilo de
 * "identidad" de la app (DRY).
 */

/** Paleta de 10 colores dentro de la gama azul / celeste / verde / naranja:
 * tonos de la misma familia pero lo bastante distintos a la vista como para
 * que el gráfico del resumen y los avatares se lean de un tirón. */
const PALETTE = [
  '#2f6fed', // azul marca
  '#1e9e5a', // verde
  '#3153c4', // azul profundo
  '#d0892b', // ámbar
  '#1c9ad6', // azul cielo
  '#c2571e', // naranja ladrillo
  '#3ba7e0', // celeste
  '#e3653a', // naranja encendido
  '#0f9d8f', // verde azulado
  '#7fb22c', // verde lima
];

/** Iniciales: con nombre + apellido salen las dos primeras letras (una por
 * palabra); sin apellido, sale una sola letra. */
export function getInitials(display: string): string {
  const words = display.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0][0]?.toUpperCase() || '?';
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Color estable por apodo: mismo nombre siempre el mismo color. */
export function avatarColor(display: string): string {
  let hash = 0;
  for (let i = 0; i < display.length; i++) {
    hash = (hash * 31 + display.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}