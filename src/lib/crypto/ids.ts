import { b64uEncode, randomBytes } from './bytes';
import { ID_BYTES } from './constants';

/** Identificador aleatorio de 128 bits en base64url (22 caracteres). Sin ULID/UUIDv7: llevan la hora dentro (§5.1). */
export function newId(): string {
  return b64uEncode(randomBytes(ID_BYTES));
}

const ID_RE = /^[A-Za-z0-9_-]{22}$/;
export function isId(s: unknown): s is string {
  return typeof s === 'string' && ID_RE.test(s);
}
