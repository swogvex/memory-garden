/** Utilidades de bytes del servidor. Autocontenidas a propósito: el Worker no importa `lib/crypto` (código de cliente). */
export type Bytes = Uint8Array<ArrayBuffer>;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function utf8(text: string): Bytes {
  return new TextEncoder().encode(text);
}

export function randomBytes(length: number): Bytes {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/** base64url sin relleno (RFC 4648 §5). */
export function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodificación estricta: solo el alfabeto base64url, sin relleno, longitud posible y forma canónica
 * (los bits sobrantes del último carácter deben ser cero). Devuelve `null` si algo no cuadra.
 */
export function fromB64Url(text: string): Bytes | null {
  if (typeof text !== 'string' || text.length === 0 || text.length % 4 === 1) return null;
  for (let i = 0; i < text.length; i++) if (!ALPHABET.includes(text.charAt(i))) return null;
  let bin: string;
  try {
    bin = atob(
      text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4),
    );
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return toB64Url(out) === text ? out : null;
}

/** Comparación en tiempo constante respecto al contenido (la longitud no es secreta aquí). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Token de sesión: 256 bits aleatorios, 43 caracteres. */
export function randomToken(): string {
  return toB64Url(randomBytes(32));
}

/** Id de cuenta: 128 bits aleatorios, 22 caracteres. */
export function randomId(): string {
  return toB64Url(randomBytes(16));
}
