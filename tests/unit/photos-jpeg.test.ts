import { describe, expect, it } from 'vitest';
import { PhotoError } from '@/lib/photos/errors';
import { isJpegMetadataFree, readJpegInfo, stripJpegMetadata, walkJpeg } from '@/lib/photos/jpeg';
import { readDisplaySize } from '@/lib/photos/size';
import {
  ascii,
  concat,
  GPS_SENTINEL,
  latin1,
  makeJpeg,
  markersOf,
  segment,
} from './_photo-helpers';

describe('walkJpeg', () => {
  it('lista los segmentos hasta SOS y marca dónde empiezan los datos', () => {
    const jpeg = makeJpeg({ exif: true });
    const walk = walkJpeg(jpeg);
    expect(walk?.segments.map((s) => s.marker)).toEqual([0xe0, 0xe1, 0xdb, 0xc0, 0xda]);
    const at = walk?.scanStart ?? 0;
    expect(Array.from(jpeg.subarray(at, at + 5))).toEqual([0x12, 0x34, 0xff, 0x00, 0x56]);
  });
  it('rechaza lo truncado (estricto) y lo tolera (tolerante)', () => {
    const cut = makeJpeg({ exif: true }).subarray(0, 40);
    expect(walkJpeg(cut)).toBeNull();
    expect(walkJpeg(cut, true)?.complete).toBe(false);
  });
  it('admite bytes de relleno 0xFF antes de un marcador', () => {
    const b = concat(
      [0xff, 0xd8, 0xff],
      segment(0xe0, [1, 2]),
      segment(0xda, [1, 1, 0, 0, 63, 0]),
      [1, 0xff, 0xd9],
    );
    expect(walkJpeg(b)?.segments.map((s) => s.marker)).toEqual([0xe0, 0xda]);
  });
  it('rechaza lo que no empieza por SOI', () => {
    expect(walkJpeg(Uint8Array.of(1, 2, 3))).toBeNull();
  });
});

describe('stripJpegMetadata (PS-39, parte de estructura)', () => {
  it('elimina Exif con GPS y comentarios, y conserva la imagen byte a byte', () => {
    const jpeg = makeJpeg({ exif: true, comment: 'iPhone de Fulano', padding: 500 });
    expect(latin1(jpeg)).toContain(GPS_SENTINEL); // control: la entrada sí lo tiene
    const out = stripJpegMetadata(jpeg);
    expect(markersOf(out)).toEqual([0xe0, 0xdb, 0xc0, 0xda]);
    expect(latin1(out)).not.toContain(GPS_SENTINEL);
    expect(latin1(out)).not.toContain('Exif');
    expect(latin1(out)).not.toContain('iPhone');
    const tail = (b: Uint8Array) => Array.from(b.subarray(walkJpeg(b)?.scanStart ?? 0));
    expect(tail(out)).toEqual(tail(jpeg));
  });
  it('conserva el perfil ICC pero no otros APP2', () => {
    const out = stripJpegMetadata(makeJpeg({ icc: true, mpf: true, exif: true }));
    expect(markersOf(out)).toEqual([0xe0, 0xe2, 0xdb, 0xc0, 0xda]);
    expect(latin1(out)).toContain('ICC_PROFILE');
    expect(latin1(out)).not.toContain('MPF');
  });
  it('es idempotente y el resultado cuenta como limpio', () => {
    const jpeg = makeJpeg({ exif: true });
    expect(isJpegMetadataFree(jpeg)).toBe(false);
    const once = stripJpegMetadata(jpeg);
    expect(isJpegMetadataFree(once)).toBe(true);
    expect(Array.from(stripJpegMetadata(once))).toEqual(Array.from(once));
  });
  it('lanza encode_failed si no es un JPEG', () => {
    expect(() => stripJpegMetadata(Uint8Array.of(1, 2, 3))).toThrowError('photo:encode_failed');
    expect(() => stripJpegMetadata(Uint8Array.of(1, 2, 3))).toThrow(PhotoError);
  });
  it('un JPEG con datos añadidos tras EOI no cuenta como limpio', () => {
    expect(isJpegMetadataFree(concat(makeJpeg(), [1, 2, 3]))).toBe(false);
  });
});

describe('readJpegInfo / readDisplaySize', () => {
  it('lee tamaño y orientación en little y big endian', () => {
    for (const little of [true, false]) {
      const info = readJpegInfo(
        makeJpeg({ width: 4032, height: 3024, exif: true, orientation: 6, little }),
      );
      expect(info).toEqual({ width: 4032, height: 3024, orientation: 6 });
    }
  });
  it('con orientación 5–8 el tamaño mostrado intercambia ancho y alto', () => {
    const b = makeJpeg({ width: 4032, height: 3024, exif: true, orientation: 8 });
    expect(readDisplaySize(b, 'jpeg')).toEqual({ width: 3024, height: 4032 });
    expect(
      readDisplaySize(makeJpeg({ width: 4032, height: 3024, exif: true, orientation: 3 }), 'jpeg'),
    ).toEqual({ width: 4032, height: 3024 });
  });
  it('orientación ausente o inválida = 1', () => {
    expect(readJpegInfo(makeJpeg())?.orientation).toBe(1);
    expect(readJpegInfo(makeJpeg({ exif: true, orientation: 9 }))?.orientation).toBe(1);
  });
  it('lee el tamaño con solo el principio del archivo', () => {
    const b = makeJpeg({ width: 100, height: 50, padding: 5000 });
    expect(readJpegInfo(b.subarray(0, 200))).toMatchObject({ width: 100, height: 50 });
  });
  it('PNG: lee IHDR y rechaza cabeceras cortas', () => {
    const png = (w: number, h: number) =>
      concat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], ascii('IHDR'), [
        w >>> 24,
        (w >> 16) & 255,
        (w >> 8) & 255,
        w & 255,
        h >>> 24,
        (h >> 16) & 255,
        (h >> 8) & 255,
        h & 255,
      ]);
    expect(readDisplaySize(png(30000, 20000), 'png')).toEqual({ width: 30000, height: 20000 });
    expect(readDisplaySize(png(1, 1).subarray(0, 20), 'png')).toBeNull();
  });
  it('WebP y HEIC: tamaño desconocido', () => {
    expect(readDisplaySize(new Uint8Array(64), 'webp')).toBeNull();
    expect(readDisplaySize(new Uint8Array(64), 'heic')).toBeNull();
  });
});
