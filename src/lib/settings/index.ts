/**
 * API pública de lib/settings: modelo de los ajustes y fuente de datos cifrada. Sin interfaz: la usan
 * `features/access` (crea la fuente al desbloquear) y `features/settings` (pantallas).
 */
export {
  AVATAR_PRESETS,
  SettingsError,
  addCategory,
  canAddCategory,
  canRemoveCategory,
  categoryNameIssue,
  defaultSettings,
  removeCategory,
  renameCategory,
  withCategories,
} from './model';
export type { Category, DateFormat, Flower, SettingsErrorCode, SettingsSource } from './model';
export { createSettingsSource } from './source';
