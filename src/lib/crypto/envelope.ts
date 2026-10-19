import {
  ALG_AES256GCM,
  ENVELOPE_OVERHEAD,
  FORMAT_VERSION,
  HEADER_BYTES,
  NONCE_BYTES,
  TAG_BYTES,
} from './constants';
import type { Purpose } from './constants';
import { concat, randomBytes, utf8 } from './bytes';
import type { Bytes } from './bytes';
import { CryptoError } from './errors';

/**
 * Envoltorio binario versionado (crypto-spec.md §5.4):
 *   [versión 1][algoritmo 1][finalidad 1][mk_version 1][nonce 12][texto cifrado || etiqueta 16]
 * AAD = cabecera(4 B) || UTF-8(contexto): la cabecera queda autenticada.
 */

function aadFor(header: Uint8Array, context: string): Bytes {
  return concat(header, utf8(context));
}

/** Uso interno y de pruebas con vectores. NO exportar desde index.ts. */
export async function sealWithNonce(
  key: CryptoKey,
  plaintext: Uint8Array,
  purpose: Purpose,
  mkVersion: number,
  context: string,
  nonce: Uint8Array,
): Promise<Bytes> {
  if (
    nonce.length !== NONCE_BYTES ||
    !Number.isInteger(mkVersion) ||
    mkVersion < 0 ||
    mkVersion > 255
  ) {
    throw new CryptoError('invalid_input');
  }
  const header = new Uint8Array([FORMAT_VERSION, ALG_AES256GCM, purpose, mkVersion]);
  const ct = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce as BufferSource,
      additionalData: aadFor(header, context),
      tagLength: TAG_BYTES * 8,
    },
    key,
    plaintext as BufferSource,
  );
  return concat(header, nonce, new Uint8Array(ct));
}

/** Cifra con nonce ALEATORIO de 96 bits por cada llamada (nunca contador casero, §5.2). */
export async function seal(
  key: CryptoKey,
  plaintext: Uint8Array,
  purpose: Purpose,
  mkVersion: number,
  context: string,
): Promise<Bytes> {
  try {
    return await sealWithNonce(
      key,
      plaintext,
      purpose,
      mkVersion,
      context,
      randomBytes(NONCE_BYTES),
    );
  } catch (e) {
    if (e instanceof CryptoError) throw e;
    throw new CryptoError('unavailable');
  }
}

export interface Opened {
  readonly plaintext: Bytes;
  readonly mkVersion: number;
}

/**
 * Descifra y autentica. Cualquier fallo (clave, AAD, manipulación, truncado)
 * produce el MISMO error genérico; nunca se devuelve texto parcial (§5.2).
 */
export async function open(
  key: CryptoKey,
  envelope: Uint8Array,
  expectedPurpose: Purpose,
  context: string,
): Promise<Opened> {
  if (envelope.length < ENVELOPE_OVERHEAD) throw new CryptoError('decrypt_failed');
  const header = envelope.subarray(0, HEADER_BYTES);
  if (header[0] !== FORMAT_VERSION || header[1] !== ALG_AES256GCM)
    throw new CryptoError('format_unsupported');
  if (header[2] !== expectedPurpose) throw new CryptoError('decrypt_failed');
  const nonce = envelope.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
  const body = envelope.subarray(HEADER_BYTES + NONCE_BYTES);
  try {
    const pt = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce as BufferSource,
        additionalData: aadFor(header, context),
        tagLength: TAG_BYTES * 8,
      },
      key,
      body as BufferSource,
    );
    return { plaintext: new Uint8Array(pt), mkVersion: header[3]! };
  } catch {
    throw new CryptoError('decrypt_failed');
  }
}
