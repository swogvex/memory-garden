/** Constantes del formato (crypto-spec.md §3, §5, §5.4). Cambiarlas rompe datos existentes. */

export const FORMAT_VERSION = 0x01;
export const ALG_AES256GCM = 0x01;
export const HEADER_BYTES = 4;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const ENVELOPE_OVERHEAD = HEADER_BYTES + NONCE_BYTES + TAG_BYTES; // 32

/** Finalidad (byte 2 de la cabecera). */
export const PURPOSE = {
  data: 0x01,
  asset: 0x02,
  export: 0x03,
  wrapPw: 0x10,
  wrapRec: 0x11,
} as const;
export type Purpose = (typeof PURPOSE)[keyof typeof PURPOSE];

/** Etiquetas HKDF `info` (§3). */
export const INFO = {
  authPw: 'mg1/auth/pw',
  kekPw: 'mg1/kek/pw',
  authRec: 'mg1/auth/rec',
  kekRec: 'mg1/kek/rec',
  keyData: 'mg1/key/data',
  keyAsset: 'mg1/key/asset',
  keyExport: 'mg1/key/export',
} as const;

export const MK_BYTES = 32;
export const KDF_SALT_BYTES = 16;
export const REC_SALT_BYTES = 16;
export const ID_BYTES = 16;

/** Relleno en cubos (§5.5). El prefijo de longitud (4 B) va DENTRO del cubo. */
export const PAD_BUCKETS = [1024, 2048, 4096, 8192, 16384, 32768] as const;
export const PAD_PREFIX_BYTES = 4;
/** Contenido máximo = cubo mayor − prefijo (corrige "32 KiB" de §5.5). */
export const MAX_CONTENT_BYTES = 32768 - PAD_PREFIX_BYTES;

export const MIN_PASSWORD_LENGTH = 14;

export interface KdfPolicy {
  /** Suelo: por debajo, el cliente aborta antes de enviar nada (PS-11). */
  readonly minIter: number;
  /** Techo: evita que un servidor hostil congele el cliente (añadido en H3). */
  readonly maxIter: number;
  /** Valor con el que se crean/actualizan los espacios. */
  readonly targetIter: number;
  readonly algs: readonly string[];
}

/** Política de producción (D-050, D-081). `targetIter` se calibra con PS-66. */
export const PRODUCTION_KDF_POLICY: KdfPolicy = Object.freeze({
  minIter: 600_000,
  maxIter: 10_000_000,
  targetIter: 1_500_000,
  algs: Object.freeze(['pbkdf2-sha256']),
});
