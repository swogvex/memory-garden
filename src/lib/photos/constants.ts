import { MAX_ASSET_BYTES } from '@/lib/storage';

/** Techo del archivo de entrada (photos-and-storage.md §2). */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
/** Píxeles declarados máximos (≈ 120 Mpx): protege frente a «bombas de descompresión» (D-133). */
export const MAX_INPUT_PIXELS = 120_000_000;
/** Cabecera 4 B + nonce 12 B + etiqueta 16 B del sobre cifrado (crypto-spec §5.4). */
export const ENVELOPE_OVERHEAD = 32;
/** Bytes del archivo que se leen para detectar el tipo y el tamaño. */
export const HEADER_BYTES = 512 * 1024;
/** Límite de área del canvas de Safari en iOS. */
export const MAX_CANVAS_AREA = 16_777_216;

export const PHOTO_MAX_SIDE = 2048;
export const THUMB_MAX_SIDE = 480;

export interface VariantSpec {
  /** Lados largos a probar, de mayor a menor. */
  readonly sides: readonly number[];
  /** Calidades JPEG a probar para cada lado. */
  readonly qualities: readonly number[];
  /** Tamaño máximo del JPEG (antes de cifrar). */
  readonly maxBytes: number;
}

export const PHOTO_SPEC: VariantSpec = {
  sides: [PHOTO_MAX_SIDE, 1600],
  qualities: [0.82, 0.72, 0.62],
  maxBytes: MAX_ASSET_BYTES.photo - ENVELOPE_OVERHEAD,
};

export const THUMB_SPEC: VariantSpec = {
  sides: [THUMB_MAX_SIDE, 320],
  qualities: [0.75, 0.65, 0.55],
  maxBytes: MAX_ASSET_BYTES.thumb - ENVELOPE_OVERHEAD,
};

/** Avatar (H8.1, D-094): entrada JPG, PNG o WEBP de hasta 5 MB; sale un JPEG sin metadatos de lado largo ≤ 256 px. */
export const AVATAR_MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const AVATAR_MAX_SIDE = 256;
export const AVATAR_SPEC: VariantSpec = {
  sides: [AVATAR_MAX_SIDE, 192],
  qualities: [0.85, 0.75, 0.65],
  maxBytes: MAX_ASSET_BYTES.avatar - ENVELOPE_OVERHEAD,
};
