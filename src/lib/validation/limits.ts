/**
 * Constantes de validación SIN dependencias (se pueden importar y probar sin cargar Valibot).
 * Límites de validación (D-119, D-232): cambiarlos no afecta
 * al formato cifrado, solo a lo que la interfaz acepta al escribir.
 */
export const FLOWERS = [
  'lavanda',
  'hortensia',
  'margarita',
  'rosa',
  'tulipan',
  'girasol',
  'dalia',
  'camelia',
] as const;
export const SEASONS = ['primavera', 'verano', 'otono', 'invierno'] as const;
export const DATE_FORMATS = ['dmy', 'mdy', 'ymd'] as const;
export const LANGUAGES = ['es', 'en'] as const;

export const MAX_PHOTOS = 5; // D-006 (debe coincidir con lib/storage MAX_PHOTOS_PER_MEMORY; hay una prueba)
export const MAX_CATEGORIES = 12; // D-232

/** Longitudes en unidades UTF-16 (`String.length`). El peor caso en bytes UTF-8 es 3 × longitud. */
export const LIMITS = {
  title: 120,
  category: 40,
  text: 5000,
  alt: 200,
  displayName: 60,
  welcome: 500,
  link: 2048,
} as const;
