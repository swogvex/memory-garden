/**
 * Estado compartido de los ajustes: lo leen la cabecera, el Jardín, Ramos, el formulario y Configuración.
 * Vive solo en memoria. Lo único que sale de aquí hacia el navegador es el idioma (`local-language.ts`).
 *
 * Reglas:
 * - Antes de entrar (o si los ajustes no cargan) se usan los valores por defecto con el idioma recordado.
 * - Los guardados van en fila: cada uno parte de lo último guardado, así dos cambios seguidos no chocan entre sí.
 * - Si otro dispositivo guardó antes (`conflict`), se recarga lo del servidor y la pantalla pide repetir el cambio:
 *   nunca se pisa a ciegas lo que guardó el otro dispositivo.
 * - Si el documento no se puede abrir (`unreadable`), no se guarda nada encima.
 */
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n';
import {
  SettingsError,
  defaultSettings,
  withCategories,
  type Flower,
  type SettingsErrorCode,
  type SettingsSource,
} from '@/lib/settings';
import type { Settings } from '@/lib/validation';
import { readLocalLanguage, writeLocalLanguage } from './local-language';

type PrefsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PrefsState {
  status: PrefsStatus;
  error: SettingsErrorCode | null;
  settings: Settings;
  revision: number;
  /** URL `blob:` del avatar subido, si lo hay (de la fuente: no se revoca aquí). */
  avatarUrl: string | null;
}

export const prefs: PrefsState = $state({
  status: 'idle',
  error: null,
  settings: defaultSettings(readLocalLanguage() ?? DEFAULT_LOCALE),
  revision: 0,
  avatarUrl: null,
});

let source: SettingsSource | null = null;
let opener: (() => Promise<SettingsSource>) | null = null;
let generation = 0;
let queue: Promise<unknown> = Promise.resolve();

const asError = (error: unknown): SettingsError =>
  error instanceof SettingsError ? error : new SettingsError('unavailable');

async function refreshAvatar(): Promise<void> {
  const avatar = prefs.settings.avatar;
  const current = source;
  const gen = generation;
  const url = avatar?.kind === 'asset' && current ? await current.avatarUrl(avatar.assetId) : null;
  if (gen === generation) prefs.avatarUrl = url;
}

/** Carga los ajustes del espacio desbloqueado. Se puede volver a llamar (botón «Reintentar»). */
export async function loadPrefs(open?: () => Promise<SettingsSource>): Promise<void> {
  if (open) opener = open;
  if (!opener) return;
  const gen = ++generation;
  // Una recarga con los ajustes ya en pantalla (tras un conflicto) no los oculta: así la pantalla conserva su aviso.
  if (prefs.status !== 'ready') prefs.status = 'loading';
  prefs.error = null;
  try {
    const next = await opener();
    const stored = await next.load();
    if (gen !== generation) return;
    source = next;
    // Sin ajustes guardados: los de serie, en el idioma que se esté usando (se guardan con el primer cambio).
    prefs.settings = stored.settings
      ? withCategories(stored.settings)
      : defaultSettings(prefs.settings.language);
    prefs.revision = stored.revision;
    prefs.status = 'ready';
    writeLocalLanguage(prefs.settings.language);
    await refreshAvatar();
  } catch (error) {
    if (gen !== generation) return;
    source = null;
    prefs.status = 'error';
    prefs.error = asError(error).code;
  }
}

/** Al bloquear o cerrar sesión: vuelve a los valores por defecto, conservando el idioma en pantalla. */
export function resetPrefs(): void {
  generation++;
  source = null;
  queue = Promise.resolve();
  prefs.status = 'idle';
  prefs.error = null;
  prefs.settings = defaultSettings(prefs.settings.language);
  prefs.revision = 0;
  prefs.avatarUrl = null;
}

/** Idioma elegido en la pantalla de acceso (sin sesión): solo se recuerda en este navegador. */
export function chooseLocalLanguage(language: Locale): void {
  writeLocalLanguage(language);
  if (prefs.status !== 'ready') prefs.settings = { ...prefs.settings, language };
}

async function save(change: (current: Settings) => Settings): Promise<Settings> {
  const current = source;
  if (!current || prefs.status !== 'ready') throw new SettingsError('unavailable');
  const gen = generation;
  const next = change(prefs.settings);
  try {
    const revision = await current.save(next, prefs.revision);
    if (gen !== generation) throw new SettingsError('unavailable');
    prefs.settings = next;
    prefs.revision = revision;
    writeLocalLanguage(next.language);
    return next;
  } catch (error) {
    const failure = asError(error);
    if (failure.code === 'conflict' && gen === generation) await loadPrefs();
    throw failure;
  }
}

/** Guarda un cambio sobre los últimos ajustes guardados. Los cambios se aplican de uno en uno, en orden. */
export function updatePrefs(change: (current: Settings) => Settings): Promise<Settings> {
  const run = queue.then(() => save(change));
  queue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------------------------------------------
// Avatar: subir primero, guardar los ajustes después y solo entonces borrar el anterior. Si algo falla a medias,
// lo que queda es como mucho un avatar huérfano (cifrado), nunca unos ajustes que apunten a un avatar borrado.

async function replaceAvatar(next: Settings['avatar']): Promise<void> {
  const before = prefs.settings.avatar;
  await updatePrefs((s) => ({ ...s, avatar: next }));
  if (before?.kind === 'asset' && !(next?.kind === 'asset' && next.assetId === before.assetId))
    await source?.deleteAvatar(before.assetId).catch(() => undefined);
  await refreshAvatar();
}

export function choosePresetAvatar(flower: Flower): Promise<void> {
  return replaceAvatar({ kind: 'preset', id: flower });
}

export function clearAvatar(): Promise<void> {
  return replaceAvatar(null);
}

/** `jpeg`: la salida de `processAvatar` (sin metadatos). */
export async function uploadAvatar(jpeg: Uint8Array): Promise<void> {
  const current = source;
  if (!current || prefs.status !== 'ready') throw new SettingsError('unavailable');
  let id: string;
  try {
    id = await current.uploadAvatar(jpeg);
  } catch (error) {
    throw asError(error);
  }
  try {
    await replaceAvatar({ kind: 'asset', assetId: id });
  } catch (error) {
    await current.deleteAvatar(id).catch(() => undefined);
    throw asError(error);
  }
}

/** Zona horaria para saber qué día es «hoy»: la elegida o, si no, la del dispositivo (`undefined`). */
export function effectiveTimeZone(): string | undefined {
  return prefs.settings.timeZone ?? undefined;
}
