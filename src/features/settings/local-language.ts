import { isLocale, type Locale } from '@/lib/i18n';

/**
 * Idioma de la pantalla de acceso, recordado en este navegador (privacy-and-backups.md §5, D-104).
 * Es el ÚNICO dato que la app guarda en el almacenamiento local: «es» o «en», nada más. Antes de entrar no se pueden
 * leer los ajustes cifrados, así que sin esto la pantalla de acceso no sabría en qué idioma mostrarse.
 * Puede fallar (modo privado, almacenamiento bloqueado o borrado por Safari a los 7 días): entonces se usa el español.
 */
export const LOCAL_LANGUAGE_KEY = 'mg.lang';

export function readLocalLanguage(): Locale | null {
  try {
    const value = window.localStorage.getItem(LOCAL_LANGUAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLocalLanguage(language: Locale): void {
  try {
    window.localStorage.setItem(LOCAL_LANGUAGE_KEY, language);
  } catch {
    // sin almacenamiento: la próxima vez la pantalla de acceso saldrá en español
  }
}
