/**
 * API pública de lib/settings (H8.1): modelo de los ajustes y fuente de datos cifrada. Sin interfaz: la usan
 * `features/access` (crea la fuente al desbloquear) y `features/settings` (pantallas).
 */
export {
  AVATAR_PRESETS,
  SettingsError,
  addCategory,
  canAddCategory,
  canRemoveCategory,
  categoryNameIssue,
  defaultCategories,
  defaultSettings,
  removeCategory,
  renameCategory,
  sameName,
  withCategories,
} from './model';
export type {
  Avatar,
  Category,
  DateFormat,
  Flower,
  SettingsErrorCode,
  SettingsSource,
  StoredSettings,
} from './model';
export { createSettingsSource } from './source';
