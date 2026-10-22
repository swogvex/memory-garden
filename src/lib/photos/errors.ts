/** Errores de la tubería de fotos. Mensajes FIJOS: nunca incluyen nombres de archivo ni contenido. */
export type PhotoErrorCode =
  'unsupported_format' | 'too_large' | 'decode_failed' | 'encode_failed' | 'cancelled';

export class PhotoError extends Error {
  readonly code: PhotoErrorCode;
  constructor(code: PhotoErrorCode) {
    super(`photo:${code}`);
    this.name = 'PhotoError';
    this.code = code;
  }
}
