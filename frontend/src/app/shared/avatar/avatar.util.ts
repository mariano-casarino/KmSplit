/**
 * Utilidades puras para el avatar compartido (iniciales + color determinístico).
 * Se usan en usuarios, vehículos y grupos: un solo lugar para el estilo de
 * "identidad" de la app (DRY).
 */

/** Colores sobrios, sacados de la paleta de la app (azules, verde y violeta
 * de styles.scss) para que el avatar se integre sin gritar. */
const PALETTE = [
  '#2f6fed',
  '#2f8e58',
  '#8a63d2',
  '#2e8b8b',
  '#b0764a',
  '#4b70a2',
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