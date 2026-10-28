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
