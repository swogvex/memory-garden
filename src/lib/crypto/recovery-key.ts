import { b64uDecode, randomBytes, zero } from './bytes';
import type { Bytes } from './bytes';
import { INFO, REC_SALT_BYTES } from './constants';
import { CryptoError } from './errors';
import { hkdfSecrets } from './kdf';
import type { DerivedSecrets } from './kdf';

/**
 * Clave de recuperación (crypto-spec.md §7): 130 bits aleatorios + CRC-10/ATM (poly 0x233, init 0,
 * sin reflexión ni XOR final) = 140 bits = 28 caracteres Crockford Base32, en 7 grupos de 4.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DATA_BITS = 130;
const CRC_BITS = 10;
const KEY_CHARS = 28;
const IKM_BYTES = 17;

function bitAt(bytes: Uint8Array, i: number): number {
  return (bytes[i >> 3]! >> (7 - (i & 7))) & 1;
}

/** CRC-10/ATM bit a bit, MSB primero, sobre los primeros `nbits` bits. */
export function crc10(bytes: Uint8Array, nbits: number = DATA_BITS): number {
  let crc = 0;
  for (let i = 0; i < nbits; i++) {
    const feedback = ((crc >> 9) & 1) ^ bitAt(bytes, i);
    crc = (crc << 1) & 0x3ff;
    if (feedback) crc ^= 0x233;
  }
  return crc;
}

function encodeChars(ikm: Uint8Array): string {
  const crc = crc10(ikm);
  const bits: number[] = [];
  for (let i = 0; i < DATA_BITS; i++) bits.push(bitAt(ikm, i));
  for (let i = CRC_BITS - 1; i >= 0; i--) bits.push((crc >> i) & 1);
  let out = '';
  for (let c = 0; c < KEY_CHARS; c++) {
    let v = 0;
    for (let b = 0; b < 5; b++) v = (v << 1) | bits[c * 5 + b]!;
    out += ALPHABET[v]!;
  }
  return out;
}

export function formatRecoveryKey(chars: string): string {
  return chars.match(/.{4}/g)!.join('-');
}

/** Normaliza lo que teclea la usuaria: sin guiones/espacios, mayúsculas, O→0, I→1, L→1 (§7). */
export function normalizeRecoveryInput(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[\s-]+/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export interface GeneratedRecoveryKey {
  /** Texto para mostrar una sola vez: XXXX-XXXX-... */
  readonly display: string;
  /** 17 bytes (130 bits + 6 ceros): material de entrada de HKDF. */
  readonly ikm: Bytes;
}

/** Genera una clave nueva. El byte final se enmascara a 2 bits útiles. */
export function generateRecoveryKey(): GeneratedRecoveryKey {
  const ikm = randomBytes(IKM_BYTES);
  ikm[IKM_BYTES - 1]! &= 0xc0;
  return { display: formatRecoveryKey(encodeChars(ikm)), ikm };
}

/** Para vectores de prueba: usa los primeros 130 bits de `bytes` (17 B). */
export function recoveryKeyFromBytes(bytes: Uint8Array): GeneratedRecoveryKey {
  if (bytes.length !== IKM_BYTES) throw new CryptoError('invalid_input');
  const ikm = new Uint8Array(bytes);
  ikm[IKM_BYTES - 1]! &= 0xc0;
  return { display: formatRecoveryKey(encodeChars(ikm)), ikm };
}

/**
 * Lee y COMPRUEBA una clave tecleada. Todo es local (no consulta al servidor).
 *  - recovery_key_format: longitud o caracteres imposibles.
 *  - recovery_key_checksum: error de tecleo detectado por el CRC-10.
 */
export function parseRecoveryKey(input: string): Bytes {
  const s = normalizeRecoveryInput(input);
  if (s.length !== KEY_CHARS) throw new CryptoError('recovery_key_format');
  const bits: number[] = [];
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new CryptoError('recovery_key_format');
    for (let b = 4; b >= 0; b--) bits.push((v >> b) & 1);
  }
  const ikm = new Uint8Array(IKM_BYTES);
  for (let i = 0; i < DATA_BITS; i++) ikm[i >> 3]! |= bits[i]! << (7 - (i & 7));
  let got = 0;
  for (let i = 0; i < CRC_BITS; i++) got = (got << 1) | bits[DATA_BITS + i]!;
  if (got !== crc10(ikm)) {
    zero(ikm);
    throw new CryptoError('recovery_key_checksum');
  }
  return ikm;
}

export function isRecoveryKeyWellFormed(input: string): boolean {
  try {
    zero(parseRecoveryKey(input));
    return true;
  } catch {
    return false;
  }
}

/**
 * HKDF(sal = rec_salt, info = mg1/auth/rec | mg1/kek/rec). NO se estira con PBKDF2:
 * 130 bits reales no se adivinan por fuerza bruta (§7).
 */
export async function deriveRecoverySecrets(
  ikm: Uint8Array,
  recSalt: string,
): Promise<DerivedSecrets> {
  const salt = b64uDecode(recSalt);
  if (salt.length !== REC_SALT_BYTES) throw new CryptoError('invalid_input');
  return hkdfSecrets(ikm, salt, INFO.authRec, INFO.kekRec);
}
