import type { MessageKey } from '@/lib/i18n';
import type { PhotoErrorCode } from './errors';

/** Mensajes de DISENO.md §14 (provisionales hasta H8). */
export const PHOTO_ERROR_MESSAGE = {
  unsupported_format: 'photo.error.format',
  too_large: 'photo.error.large',
  decode_failed: 'photo.error.corrupt',
  encode_failed: 'photo.error.prepare',
  cancelled: 'photo.error.cancelled',
} as const satisfies Record<PhotoErrorCode, MessageKey>;
