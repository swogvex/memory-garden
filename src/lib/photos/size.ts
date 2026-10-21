import { readJpegInfo, u32be } from './jpeg';
import { asciiAt, type ImageKind } from './sniff';

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * Tamaño tal y como se verá (orientación EXIF aplicada), leído de la cabecera sin decodificar.
 * `null` si no se puede saber (WebP, HEIC…): el códec decide entonces por su cuenta.
 */
export function readDisplaySize(bytes: Uint8Array, kind: ImageKind): Size | null {
  if (kind === 'jpeg') {
    const info = readJpegInfo(bytes);
    if (!info) return null;
    return info.orientation >= 5
      ? { width: info.height, height: info.width }
      : { width: info.width, height: info.height };
  }
  if (kind === 'png') {
    if (bytes.length < 24 || asciiAt(bytes, 12, 4) !== 'IHDR') return null;
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}
