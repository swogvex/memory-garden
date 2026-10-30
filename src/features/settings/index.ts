/** Interfaz pública de Configuración (H8.1): pantallas, estado compartido de los ajustes e idioma. */
export { default as SettingsView } from './SettingsView.svelte';
export { default as AvatarBadge } from './AvatarBadge.svelte';
export { default as LanguageSwitch } from './LanguageSwitch.svelte';
export {
  chooseLocalLanguage,
  effectiveTimeZone,
  loadPrefs,
  prefs,
  resetPrefs,
  updatePrefs,
} from './prefs.svelte';
export { readLocalLanguage, LOCAL_LANGUAGE_KEY } from './local-language';
