/** Límites de photos-and-storage.md §6 y data-model.md (D-075, D-094). El Worker los aplica de verdad en H7. */
export const MAX_PHOTOS_PER_MEMORY = 5;
export const MAX_ASSETS_PER_MEMORY = MAX_PHOTOS_PER_MEMORY * 2; // fotos + miniaturas
export const MIN_ASSET_BYTES = 32;
export const MAX_ASSET_BYTES = {
  photo: 2 * 1024 * 1024,
  thumb: 256 * 1024,
  avatar: 128 * 1024,
} as const;
export const MAX_PENDING_ASSETS = 12;
export const MAX_PENDING_BYTES = 48 * 1024 * 1024;
export const TOTAL_QUOTA_BYTES = 5 * 1024 ** 3;
export const MAX_PAYLOAD_CHARS = 65536; // CHECK de memory.payload / vault.settings_payload
/** Días que un recuerdo pasa en la papelera antes de borrarse solo (D-058; `TRASH_TTL` del servidor). */
export const TRASH_DAYS = 30;
