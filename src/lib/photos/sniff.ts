export type ImageKind = 'jpeg' | 'png' | 'webp' | 'heic';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEIC_BRANDS = new Set(['heic', 'heix', 'mif1', 'heif']);

/** Texto ASCII de `length` bytes desde `at` (los que faltan cuentan como 0). */
export function asciiAt(bytes: Uint8Array, at: number, length: number): string {
  let text = '';
  for (let i = at; i < at + length; i++) text += String.fromCharCode(bytes[i] ?? 0);
  return text;
}

/**
 * Tipo REAL por contenido (no por extensión ni por el MIME declarado). La firma no es una garantía:
 * la prueba definitiva es que el navegador decodifique la imagen. GIF, SVG, PDF y vídeo dan `null`.
 */
export function sniffImageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((v, i) => bytes[i] === v))
    return 'png';
  if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP')
    return 'webp';
  if (
    bytes.length >= 12 &&
    asciiAt(bytes, 4, 4) === 'ftyp' &&
    HEIC_BRANDS.has(asciiAt(bytes, 8, 4))
  )
    return 'heic';
  return null;
}
