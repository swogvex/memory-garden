/**
 * Modelo de los ajustes. Funciones puras: sin red, sin DOM, sin claves. Las pantallas y la fuente de datos las usan.
 * El documento cifrado tiene la forma de `SettingsSchema` (lib/validation); aquí solo hay valores por defecto y reglas.
 */
import type { Locale, MessageKey } from '@/lib/i18n';
import { FLOWERS, LIMITS, MAX_CATEGORIES, isCleanText, type Settings } from '@/lib/validation';

export type Flower = (typeof FLOWERS)[number];
export type Category = Settings['categories'][number];
export type DateFormat = Settings['dateFormat'];

/** Lo guardado en el servidor: `settings = null` si el espacio aún no ha guardado ajustes (revisión 0). */
export interface StoredSettings {
  readonly settings: Settings | null;
  readonly revision: number;
}

export type SettingsErrorCode =
  /** Otro dispositivo guardó antes: hay que recargar. */
  | 'conflict'
  /** Sin conexión, sesión caducada o servidor caído. */
  | 'unavailable'
  /** No pasa la validación (no debería ocurrir: la pantalla valida antes). */
  | 'invalid'
  /** Cuota de almacenamiento (avatar). */
  | 'quota'
  /** El documento guardado no se puede abrir con estas claves. No se sobrescribe. */
  | 'unreadable';

export class SettingsError extends Error {
  readonly code: SettingsErrorCode;
  constructor(code: SettingsErrorCode) {
    super(`settings:${code}`);
    this.name = 'SettingsError';
    this.code = code;
  }
}

/** Puerto de datos de Configuración. Lo implementa `createSettingsSource` (cifra y valida) sobre cualquier `Repository`. */
export interface SettingsSource {
  load(): Promise<StoredSettings>;
  /** Guarda con la revisión conocida y devuelve la nueva. `SettingsError('conflict')` si otro dispositivo se adelantó. */
  save(settings: Settings, expectedRevision: number): Promise<number>;
  /** Sube un avatar ya procesado (JPEG sin metadatos) y devuelve su id. Queda huérfano hasta que los ajustes lo nombren. */
  uploadAvatar(jpeg: Uint8Array): Promise<string>;
  deleteAvatar(assetId: string): Promise<void>;
  /** URL `blob:` del avatar descifrado (de la fuente: no se revoca fuera); `null` si no está disponible. */
  avatarUrl(assetId: string): Promise<string | null>;
  /** Suelta las imágenes descifradas. */
  lock(): void;
}

/** Categorías de serie (D-135). Se crean en el idioma que haya al guardar los ajustes por primera vez. */
const DEFAULT_CATEGORY_NAMES: Record<Locale, readonly [string, string, string, string]> = {
  es: ['Viajes', 'Momentos', 'Naturaleza', 'Citas'],
  en: ['Travel', 'Moments', 'Nature', 'Dates'],
};
const DEFAULT_CATEGORY_FLOWERS: readonly [Flower, Flower, Flower, Flower] = [
  'girasol',
  'camelia',
  'lavanda',
  'rosa',
];

function defaultCategories(language: Locale): Category[] {
  return DEFAULT_CATEGORY_NAMES[language].map((name, i) => ({
    name,
    flower: DEFAULT_CATEGORY_FLOWERS[i] ?? 'margarita',
  }));
}

export function defaultSettings(language: Locale): Settings {
  return {
    displayName: '',
    welcomeMessage: '',
    language,
    dateFormat: 'dmy',
    timeZone: null,
    avatar: null,
    categories: defaultCategories(language),
  };
}

/** Un documento antiguo o editado a mano podría quedarse sin categorías: siempre hay al menos una. */
export function withCategories(settings: Settings): Settings {
  return settings.categories.length > 0
    ? settings
    : { ...settings, categories: defaultCategories(settings.language) };
}

// ---------------------------------------------------------------------------------------------------------------
// Categorías

/** Comparación sin mayúsculas ni espacios de más: «Viajes» y « viajes » son la misma categoría. */
const sameName = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/** Mismas reglas que el esquema (línea limpia, 1–40 caracteres) más no repetir nombre. `null` = válido. */
export function categoryNameIssue(
  name: string,
  categories: readonly Category[],
  except: string | null = null,
): MessageKey | null {
  const clean = name.trim();
  if (clean === '') return 'settings.categories.error.required';
  if (clean.length > LIMITS.category) return 'settings.categories.error.long';
  if (!isCleanText(clean)) return 'settings.categories.error.invalid';
  if (
    categories.some(
      (c) => sameName(c.name, clean) && (except === null || !sameName(c.name, except)),
    )
  )
    return 'settings.categories.error.duplicate';
  return null;
}

export const canAddCategory = (categories: readonly Category[]): boolean =>
  categories.length < MAX_CATEGORIES;
export const canRemoveCategory = (categories: readonly Category[]): boolean =>
  categories.length > 1;

export function addCategory(
  categories: readonly Category[],
  name: string,
  flower: Flower,
): Category[] {
  if (!canAddCategory(categories) || categoryNameIssue(name, categories) !== null)
    throw new SettingsError('invalid');
  return [...categories, { name: name.trim(), flower }];
}

export function renameCategory(
  categories: readonly Category[],
  from: string,
  to: string,
  flower: Flower,
): Category[] {
  if (!categories.some((c) => c.name === from) || categoryNameIssue(to, categories, from) !== null)
    throw new SettingsError('invalid');
  return categories.map((c) => (c.name === from ? { name: to.trim(), flower } : c));
}

export function removeCategory(categories: readonly Category[], name: string): Category[] {
  if (!canRemoveCategory(categories) || !categories.some((c) => c.name === name))
    throw new SettingsError('invalid');
  return categories.filter((c) => c.name !== name);
}

// ---------------------------------------------------------------------------------------------------------------
// Avatar

/** Opciones florales predefinidas: una por flor del catálogo. */
export const AVATAR_PRESETS: readonly Flower[] = FLOWERS;
