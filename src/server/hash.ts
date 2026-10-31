import { toB64Url, utf8, type Bytes } from './bytes';

/** Primitivas Web Crypto del servidor: HMAC-SHA256, SHA-256 y HKDF-SHA256. Sin KDF lento (10 ms de CPU del plan gratuito). */

export async function hmacSha256(
  key: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/** HKDF-SHA256 con sal vacía (la entrada ya es uniforme: el pepper). */
export async function hkdfSha256(
  ikm: Uint8Array<ArrayBuffer>,
  info: string,
  bytes = 32,
): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) },
    k,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/** `auth_hash = HMAC-SHA256(pepper, secreto)` en base64url (43 caracteres). crypto-spec §6. */
export async function secretHash(pepper: Bytes, secret: Bytes): Promise<string> {
  return toB64Url(await hmacSha256(pepper, secret));
}

/** SHA-256 del texto del token de sesión (43 caracteres ASCII) en base64url. */
export async function hashToken(token: string): Promise<string> {
  return toB64Url(await sha256(utf8(token)));
}
