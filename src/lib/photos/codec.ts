import type { Size } from './size';
import type { ImageKind } from './sniff';

export interface EncodedJpeg {
  readonly bytes: Uint8Array;
  /** Tipo que declara el navegador: si no es `image/jpeg` se aborta (Safari devuelve PNG ante tipos no admitidos). */
  readonly mime: string;
}

export interface DecodedImage {
  /** Tamaño con la orientación aplicada. */
  readonly width: number;
  readonly height: number;
  encodeJpeg(width: number, height: number, quality: number): Promise<EncodedJpeg>;
  /** Libera la memoria de píxeles. */
  close(): void;
}

export interface DecodeHint {
  readonly kind: ImageKind;
  /** Tamaño leído de la cabecera, si se pudo. */
  readonly displaySize: Size | null;
  /** Lado largo que se va a necesitar como máximo. */
  readonly maxSide: number;
}

/** Puerto con el navegador. La tubería no toca `document` ni `createImageBitmap` directamente. */
export interface ImageCodec {
  decode(file: Blob, hint: DecodeHint): Promise<DecodedImage>;
}
