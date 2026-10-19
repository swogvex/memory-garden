/**
 * Comprobaciones puras (sin dependencias) usadas por los esquemas de Valibot.
 * Separadas para poder probarlas sin cargar Valibot.
 */
import { LIMITS } from './limits';

/** AAAA-MM-DD real (fecha de calendario, D-024). No usa zona horaria ni `Date` local. */
export function isCalendarDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  return d <= dim;
}

export const MAX_LINK_LENGTH = LIMITS.link;

/**
 * Enlace externo: solo http(s) con `//` explícito, sin espacios ni controles, con host y SIN credenciales
 * (`https://confianza.com@malo.com` se rechaza). Rechaza javascript:, data:, //x, ftp:, etc. (PS-29).
 */
export function isHttpUrl(s: unknown): s is string {
  if (typeof s !== 'string' || s.length === 0 || s.length > MAX_LINK_LENGTH) return false;
  if (!/^https?:\/\//i.test(s)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f-\u009f]/.test(s)) return false;
  try {
    const u = new URL(s);
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      u.hostname !== '' &&
      u.username === '' &&
      u.password === ''
    );
  } catch {
    return false;
  }
}

export const isNotBlank = (s: string): boolean => s.trim().length > 0;

/**
 * Texto «limpio»: sin caracteres de control (U+0000–U+001F y U+007F–U+009F) y sin sustitutos UTF-16 sueltos.
 * Con `allowNewlines` se permiten \t, \n y \r (texto largo).
 * Motivo: en JSON un control o un sustituto suelto ocupa hasta 6 bytes (`\u0001`, `\ud800`), lo que rompería la cota
 * de tamaño del contenido cifrado (MAX_CONTENT_BYTES) con una entrada «válida» en longitud. Con esta comprobación,
 * cada unidad UTF-16 ocupa como mucho 3 bytes en el JSON y el peor caso es calculable (hay una prueba).
 */
/* eslint-disable no-control-regex -- detectar caracteres de control es justo el propósito de estas expresiones */
const CONTROLS_SINGLE_LINE = /[\u0000-\u001F\u007F-\u009F]/;
const CONTROLS_MULTI_LINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
/* eslint-enable no-control-regex */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function isCleanText(s: string, allowNewlines = false): boolean {
  if ((allowNewlines ? CONTROLS_MULTI_LINE : CONTROLS_SINGLE_LINE).test(s)) return false;
  return !LONE_SURROGATE.test(s);
}
