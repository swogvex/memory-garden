/**
 * Errores del módulo de cifrado.
 * Los mensajes son FIJOS por código: nunca incluyen contraseñas, claves,
 * ids ni texto del usuario. La interfaz decide qué mostrar según `code`.
 */
export type CryptoErrorCode =
  | 'locked'
  | 'invalid_input'
  | 'kdf_rejected'
  | 'decrypt_failed'
  | 'format_unsupported'
  | 'recovery_key_format'
  | 'recovery_key_checksum'
  | 'payload_too_large'
  | 'password_policy'
  | 'unavailable';

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;
  constructor(code: CryptoErrorCode) {
    super(`crypto:${code}`);
    this.name = 'CryptoError';
    this.code = code;
  }
}
