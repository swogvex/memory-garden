import type { ImageCodec } from '@/lib/photos/codec';
import { walkJpeg } from '@/lib/photos/jpeg';

export const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
export const GPS_SENTINEL = 'GPS-SENTINEL-41.38N';

export function concat(...parts: ReadonlyArray<ArrayLike<number>>): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function segment(marker: number, payload: ArrayLike<number>): Uint8Array {
  const length = payload.length + 2;
  return concat([0xff, marker, length >> 8, length & 255], payload);
}

function exifPayload(orientation = 1, little = true): Uint8Array {
  const u16 = (v: number): number[] =>
    little ? [v & 255, (v >> 8) & 255] : [(v >> 8) & 255, v & 255];
  const u32 = (v: number): number[] =>
    little
      ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]
      : [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const header = [...ascii('Exif'), 0, 0, ...ascii(little ? 'II' : 'MM'), ...u16(42), ...u32(8)];
  const entries = [
    ...u16(0x0112),
    ...u16(3),
    ...u32(1),
    ...u16(orientation),
    0,
    0, // orientación
    ...u16(0x8825),
    ...u16(4),
    ...u32(1),
    ...u32(0), // puntero al IFD de GPS
  ];
  return Uint8Array.from([...header, ...u16(2), ...entries, ...u32(0), ...ascii(GPS_SENTINEL)]);
}

export interface JpegOptions {
  width?: number;
  height?: number;
  exif?: boolean;
  orientation?: number;
  little?: boolean;
  comment?: string;
  icc?: boolean;
  mpf?: boolean;
  /** Bytes de datos de imagen añadidos (para fijar el tamaño). */
  padding?: number;
}

/** JPEG sintético con la estructura de segmentos real (no decodificable: solo para pruebas de estructura). */
export function makeJpeg(o: JpegOptions = {}): Uint8Array {
  const width = o.width ?? 64;
  const height = o.height ?? 48;
  const parts: Uint8Array[] = [
    Uint8Array.of(0xff, 0xd8),
    segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
  ];
  if (o.exif) parts.push(segment(0xe1, exifPayload(o.orientation ?? 1, o.little ?? true)));
  if (o.icc) parts.push(segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 1, 2, 3]));
  if (o.mpf) parts.push(segment(0xe2, [...ascii('MPF'), 0, 9, 9]));
  if (o.comment) parts.push(segment(0xfe, ascii(o.comment)));
  parts.push(segment(0xdb, [0, ...new Array<number>(64).fill(8)]));
  parts.push(segment(0xc0, [8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]));
  parts.push(segment(0xda, [1, 1, 0, 0, 63, 0]));
  parts.push(Uint8Array.of(0x12, 0x34, 0xff, 0x00, 0x56));
  parts.push(new Uint8Array(o.padding ?? 16).fill(0x55));
  parts.push(Uint8Array.of(0xff, 0xd9));
  return concat(...parts);
}

export function markersOf(b: Uint8Array): number[] {
  const walk = walkJpeg(b);
  if (!walk) throw new Error('no es un JPEG estructurado');
  return walk.segments.map((s) => s.marker);
}

export const blobOf = (bytes: Uint8Array): Blob => new Blob([bytes.slice().buffer]);
export const latin1 = (b: Uint8Array): string => Buffer.from(b).toString('latin1');

export interface FakeOptions {
  width?: number;
  height?: number;
  bytesFor?: (width: number, height: number, quality: number) => number;
  exif?: boolean;
  mime?: string;
  decodeError?: Error;
  encodeBytes?: Uint8Array;
}

/** Códec falso: sin navegador. Registra llamadas y la concurrencia máxima. */
export function fakeCodec(o: FakeOptions = {}) {
  const state = {
    decodes: 0,
    closes: 0,
    active: 0,
    maxActive: 0,
    encodes: [] as Array<{ width: number; height: number; quality: number }>,
  };
  const codec: ImageCodec = {
    async decode() {
      state.decodes++;
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (o.decodeError) {
        state.active--;
        throw o.decodeError;
      }
      return {
        width: o.width ?? 4000,
        height: o.height ?? 3000,
        async encodeJpeg(width, height, quality) {
          state.encodes.push({ width, height, quality });
          return {
            bytes:
              o.encodeBytes ??
              makeJpeg({
                width,
                height,
                padding: o.bytesFor?.(width, height, quality) ?? 1000,
                ...(o.exif ? { exif: true, comment: 'camara' } : {}),
              }),
            mime: o.mime ?? 'image/jpeg',
          };
        },
        close() {
          state.closes++;
          state.active--;
        },
      };
    },
  };
  return { codec, state };
}
