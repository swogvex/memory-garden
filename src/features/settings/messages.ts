import type { MessageKey } from '@/lib/i18n';
import { PHOTO_ERROR_MESSAGE, PhotoError } from '@/lib/photos';
import { SettingsError } from '@/lib/settings';
import { MoveError } from './categories-flow';

/** Mensaje de un fallo al guardar. Nunca incluye datos de la persona ni detalles técnicos. */
export function saveErrorKey(error: unknown): MessageKey {
  if (error instanceof SettingsError) {
    if (error.code === 'conflict') return 'settings.error.conflict';
    if (error.code === 'quota') return 'settings.error.quota';
  }
  return 'settings.error.save';
}

export function avatarErrorKey(error: unknown): MessageKey {
  if (error instanceof PhotoError) {
    if (error.code === 'unsupported_format') return 'settings.avatar.error.format';
    if (error.code === 'too_large') return 'settings.avatar.error.large';
    return PHOTO_ERROR_MESSAGE[error.code];
  }
  return saveErrorKey(error);
}

export interface Status {
  readonly kind: 'ok' | 'error';
  readonly key: MessageKey;
  readonly params?: Record<string, string | number>;
}

/** Fallo de renombrar/eliminar: si se quedó a medias, se dice cuántos recuerdos ya cambiaron. */
export function categoryErrorStatus(error: unknown): Status {
  if (error instanceof MoveError)
    return {
      kind: 'error',
      key: 'settings.categories.error.partial',
      params: { done: error.done, total: error.total },
    };
  return { kind: 'error', key: saveErrorKey(error) };
}
