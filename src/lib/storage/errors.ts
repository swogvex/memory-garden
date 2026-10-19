/** Errores del repositorio. Mensajes FIJOS: nunca incluyen ids, textos ni contenido. */
export type StorageErrorCode =
  'not_found' | 'conflict' | 'invalid' | 'quota' | 'too_large' | 'unavailable';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode) {
    super(`storage:${code}`);
    this.name = 'StorageError';
    this.code = code;
  }
}
