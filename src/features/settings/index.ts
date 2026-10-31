/** Interfaz pública de Configuración: pantallas, estado compartido de los ajustes e idioma. */
export { default as SettingsView } from './SettingsView.svelte';
export { default as AvatarBadge } from './AvatarBadge.svelte';
export { default as LanguageSwitch } from './LanguageSwitch.svelte';
export { effectiveTimeZone, loadPrefs, prefs, resetPrefs } from './prefs.svelte';
