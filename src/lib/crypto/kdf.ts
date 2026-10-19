import { b64uDecode, b64uEncode, randomBytes, utf8, zero } from './bytes';
import type { Bytes } from './bytes';
import { INFO, KDF_SALT_BYTES, PRODUCTION_KDF_POLICY } from './constants';
import type { KdfPolicy } from './constants';
import { CryptoError } from './errors';

/** Registro KDF guardado en el servidor (no secreto). Orden de claves FIJO: se usa como AAD (§4.4). */
export interface KdfParams {
  readonly v: 1;
  readonly alg: 'pbkdf2-sha256';
  readonly iter: number;
  readonly salt: string; // 16 bytes en base64url
}

export function canonicalKdf(p: KdfParams): string {
  return `{"v":${p.v},"alg":"${p.alg}","iter":${p.iter},"salt":"${p.salt}"}`;
}

/**
 * Valida un registro KDF recibido del servidor ANTES de derivar nada (PS-11).
 * Exige forma canónica exacta, algoritmo conocido, iter dentro de [min, max] y sal de 16 B.
 */
export function parseKdf(json: string, policy: KdfPolicy = PRODUCTION_KDF_POLICY): KdfParams {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new CryptoError('kdf_rejected');
  }
  if (typeof raw !== 'object' || raw === null) throw new CryptoError('kdf_rejected');
  const r = raw as Record<string, unknown>;
  const { v, alg, iter, salt } = r;
  if (v !== 1) throw new CryptoError('kdf_rejected');
  if (typeof alg !== 'string' || !policy.algs.includes(alg) || alg !== 'pbkdf2-sha256') {
    throw new CryptoError('kdf_rejected');
  }
  if (
    typeof iter !== 'number' ||
    !Number.isInteger(iter) ||
    iter < policy.minIter ||
    iter > policy.maxIter
  ) {
    throw new CryptoError('kdf_rejected');
  }
  if (typeof salt !== 'string') throw new CryptoError('kdf_rejected');
  try {
    if (b64uDecode(salt).length !== KDF_SALT_BYTES) throw new CryptoError('kdf_rejected');
  } catch {
    throw new CryptoError('kdf_rejected');
  }
  const params: KdfParams = { v: 1, alg: 'pbkdf2-sha256', iter, salt };
  if (canonicalKdf(params) !== json) throw new CryptoError('kdf_rejected'); // nada de formas alternativas
  return params;
}

export function newKdfParams(
  policy: KdfPolicy = PRODUCTION_KDF_POLICY,
  iter: number = policy.targetIter,
): KdfParams {
  const p: KdfParams = {
    v: 1,
    alg: 'pbkdf2-sha256',
    iter,
    salt: b64uEncode(randomBytes(KDF_SALT_BYTES)),
  };
  parseKdf(canonicalKdf(p), policy); // misma validación que al recibirlo
  return p;
}

/** ¿Debe actualizarse? (§8.6): versión/algoritmo distinto o iter por debajo del objetivo de la política. */
export function kdfNeedsUpgrade(json: string, policy: KdfPolicy = PRODUCTION_KDF_POLICY): boolean {
  const p = parseKdf(json, { ...policy, minIter: 1 });
  return p.v !== 1 || p.alg !== 'pbkdf2-sha256' || p.iter < policy.targetIter;
}

export interface DerivedSecrets {
  /** 32 bytes enviados al servidor como prueba (nunca la contraseña). */
  readonly auth: Bytes;
  /** Clave de envoltura AES-GCM no extraíble. */
  readonly kek: CryptoKey;
}

/** HKDF-SHA256 con sal vacía (§3 regla 2): separación por etiquetas `info`. */
export async function hkdfSecrets(
  ikm: Uint8Array,
  salt: Uint8Array,
  authInfo: string,
  kekInfo: string,
): Promise<DerivedSecrets> {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  const auth = new Uint8Array(
    await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: utf8(authInfo) },
      base,
      256,
    ),
  );
  const kek = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: utf8(kekInfo) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { auth, kek };
}

/**
 * contraseña → NFKC → UTF-8 → PBKDF2-HMAC-SHA256 (32 B, un solo bloque, §3 regla 3) → HKDF → {auth, kek}.
 * Se llama con parámetros YA validados (parseKdf). Pensado para ejecutarse en un Web Worker.
 */
export async function derivePasswordSecrets(
  password: string,
  kdf: KdfParams,
): Promise<DerivedSecrets> {
  if (typeof password !== 'string' || password.length === 0) throw new CryptoError('invalid_input');
  const subtle = globalThis.crypto.subtle;
  const pw = utf8(password.normalize('NFKC')); // sin recortar espacios (§4.4)
  let pwKey = new Uint8Array(0);
  try {
    const base = await subtle.importKey('raw', pw as BufferSource, 'PBKDF2', false, ['deriveBits']);
    pwKey = new Uint8Array(
      await subtle.deriveBits(
        {
          name: 'PBKDF2',
          hash: 'SHA-256',
          salt: b64uDecode(kdf.salt) as BufferSource,
          iterations: kdf.iter,
        },
        base,
        256,
      ),
    );
    return await hkdfSecrets(pwKey, new Uint8Array(0), INFO.authPw, INFO.kekPw);
  } finally {
    zero(pw);
    zero(pwKey);
  }
}
