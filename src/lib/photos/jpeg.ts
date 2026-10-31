import { PhotoError } from './errors';
import { asciiAt } from './sniff';

interface JpegSegment {
  readonly marker: number;
  /** Posición del 0xFF que abre el marcador. */
  readonly start: number;
  /** Fin exclusivo del segmento (marcador + longitud + datos). */
  readonly end: number;
}

export interface JpegWalk {
  readonly segments: readonly JpegSegment[];
  /** Primer byte tras la cabecera de SOS (donde empiezan los datos de imagen); `null` si no se llegó. */
  readonly scanStart: number | null;
  readonly complete: boolean;
}

const u16be = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32be = (b: Uint8Array, at: number): number =>
  (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>>
  0;
export { u32be };

/**
 * Recorre los segmentos de cabecera de un JPEG hasta SOS. No decodifica nada.
 * Estricto (por defecto): `null` si la estructura es inválida o está truncada.
 * Tolerante: devuelve lo leído (se usa con solo el principio del archivo).
 */
export function walkJpeg(b: Uint8Array, tolerant = false): JpegWalk | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const segments: JpegSegment[] = [];
  const fail = (): JpegWalk | null =>
    tolerant ? { segments, scanStart: null, complete: false } : null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return fail();
    while (b[i + 1] === 0xff) i++; // bytes de relleno
    const marker = b[i + 1];
    if (marker === undefined || marker === 0x00 || marker === 0xd9) return fail();
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (length < 2) return fail();
    const end = i + 2 + length;
    if (end > b.length) {
      if (!tolerant) return null;
      segments.push({ marker, start: i, end: b.length });
      return { segments, scanStart: null, complete: false };
    }
    segments.push({ marker, start: i, end });
    if (marker === 0xda) return { segments, scanStart: end, complete: true };
    i = end;
  }
  return fail();
}

/** Segmentos que pueden llevar metadatos personales (D-132). */
function isRemovable(b: Uint8Array, s: JpegSegment): boolean {
  const m = s.marker;
  if (m === 0xfe) return true; // comentarios
  if (m === 0xe2) return asciiAt(b, s.start + 4, 12) !== 'ICC_PROFILE\0'; // se conserva solo el perfil ICC
  return m === 0xe1 || (m >= 0xe3 && m <= 0xed) || m === 0xef; // Exif/XMP, APP3–APP13, APP15
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Quita los segmentos con metadatos y deja intactos la imagen y el resto. Lanza `encode_failed` si no es un JPEG válido. */
export function stripJpegMetadata(b: Uint8Array): Uint8Array {
  const walk = walkJpeg(b);
  if (!walk || walk.scanStart === null) throw new PhotoError('encode_failed');
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  for (const s of walk.segments) if (!isRemovable(b, s)) parts.push(b.subarray(s.start, s.end));
  parts.push(b.subarray(walk.scanStart));
  return concat(parts);
}

/** `true` si es un JPEG bien formado, sin segmentos de metadatos y que acaba en EOI (sin datos añadidos). */
export function isJpegMetadataFree(b: Uint8Array): boolean {
  const walk = walkJpeg(b);
  if (!walk || walk.scanStart === null) return false;
  if (walk.segments.some((s) => isRemovable(b, s))) return false;
  return b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
}

export interface JpegInfo {
  readonly width: number;
  readonly height: number;
  /** Orientación EXIF 1–8 (1 si no hay o no es válida). */
  readonly orientation: number;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function readExifOrientation(b: Uint8Array, s: JpegSegment): number {
  const base = s.start + 4;
  if (asciiAt(b, base, 6) !== 'Exif\0\0') return 1;
  const tiff = base + 6;
  const order = asciiAt(b, tiff, 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return 1;
  const u16 = (at: number): number =>
    little ? (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) : ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
  const u32 = (at: number): number =>
    little ? (u16(at) | (u16(at + 2) << 16)) >>> 0 : ((u16(at) << 16) | u16(at + 2)) >>> 0;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > s.end) return 1;
  const count = u16(ifd);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > s.end) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Tamaño almacenado y orientación, leídos de la cabecera (sirve con solo el principio del archivo). */
export function readJpegInfo(b: Uint8Array): JpegInfo | null {
  const walk = walkJpeg(b, true);
  if (!walk) return null;
  let width = 0;
  let height = 0;
  let orientation = 1;
  for (const s of walk.segments) {
    if (SOF.has(s.marker) && s.end - s.start >= 9) {
      height = u16be(b, s.start + 5);
      width = u16be(b, s.start + 7);
    } else if (s.marker === 0xe1 && orientation === 1) {
      orientation = readExifOrientation(b, s);
    }
  }
  return width > 0 && height > 0 ? { width, height, orientation } : null;
}
