import { fromB64Url, type Bytes } from './bytes';
import { KDF } from './config';

/**
 * Validación estructural de lo que envía el cliente. El servidor no entiende los blobs (son opacos):
 * solo comprueba forma, tamaño y cabecera, nunca contenido (crypto-spec §5.4).
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** base64url canónico de exactamente `bytes` bytes (16 → 22 caracteres, 32 → 43). */
export function b64Exact(value: unknown, bytes: number): string | null {
  if (typeof value !== 'string') return null;
  const decoded = fromB64Url(value);
  return decoded && decoded.length === bytes ? value : null;
}

/** Secreto de autenticación (`auth_pw`, `auth_rec`): 32 bytes en base64url canónico; devuelve los bytes. */
export function secretBytes(value: unknown): Bytes | null {
  const bytes = typeof value === 'string' ? fromB64Url(value) : null;
  return bytes && bytes.length === 32 ? bytes : null;
}

export function intInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : null;
}

/** Registro KDF canónico `{"v":1,"alg":"pbkdf2-sha256","iter":N,"salt":"…"}` (sin espacios, orden fijo: va dentro del AAD). */
export function parseKdf(value: unknown): { text: string; iter: number } | null {
  if (typeof value !== 'string' || value.length < 40 || value.length > 400) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(obj)) return null;
  const { v, alg, iter, salt } = obj;
  if (v !== KDF.version || alg !== KDF.alg) return null;
  const n = intInRange(iter, KDF.minIter, KDF.maxIter);
  if (n === null || b64Exact(salt, 16) === null) return null;
  const canonical = `{"v":${KDF.version},"alg":"${KDF.alg}","iter":${n},"salt":"${String(salt)}"}`;
  return canonical === value ? { text: value, iter: n } : null;
}

/** Envoltura de MK: 64 bytes (86 caracteres) con cabecera [0x01, 0x01, finalidad, 0x00]. */
export function wrappedKey(value: unknown, purpose: 'pw' | 'rec'): string | null {
  if (typeof value !== 'string' || value.length !== 86) return null;
  const bytes = fromB64Url(value);
  if (!bytes || bytes.length !== 64) return null;
  const expected = purpose === 'pw' ? 0x10 : 0x11;
  return bytes[0] === 0x01 && bytes[1] === 0x01 && bytes[2] === expected && bytes[3] === 0x00
    ? value
    : null;
}

/**
 * Carga cifrada de un recuerdo en D1: base64url canónico de un sobre con cabecera [0x01, 0x01, 0x01 (datos), mk_version].
 * Mínimo: 16 B de cabecera+nonce, 4 B de longitud y 16 B de etiqueta. Máximo: el `CHECK` de la tabla (64 KiB de texto).
 * El servidor no puede (ni debe) mirar dentro: solo forma y versión.
 */
export function memoryPayload(value: unknown, mkVersion: number, maxChars: number): string | null {
  if (typeof value !== 'string' || value.length < 48 || value.length > maxChars) return null;
  const bytes = fromB64Url(value);
  if (!bytes || bytes.length < 36) return null;
  return bytes[0] === 0x01 && bytes[1] === 0x01 && bytes[2] === 0x01 && bytes[3] === mkVersion
    ? value
    : null;
}

/** Sobre de un recurso (foto, miniatura, avatar): cabecera [0x01, 0x01, 0x02 (recursos), mk_version 1..255]. Devuelve `mk_version`. */
export function assetEnvelopeVersion(bytes: Uint8Array): number | null {
  if (bytes.length < 32 || bytes[0] !== 0x01 || bytes[1] !== 0x01 || bytes[2] !== 0x02) return null;
  const mk = bytes[3] ?? 0;
  return mk >= 1 ? mk : null;
}

/** Identificador generado por el cliente (128 bits aleatorios, 22 caracteres base64url canónicos). */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length === 22 && fromB64Url(value)?.length === 16;
}
