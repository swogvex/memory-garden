import { describe, expect, it } from 'vitest';
import {
  BackupError,
  checkManifest,
  decodePrefix,
  encodePrefix,
  layout,
  type BackupManifest,
} from '@/lib/backup/format';

/** Estructura del `.mgx` (D-100): prefijo, versión y coherencia del manifiesto. */
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof BackupError) return e.code;
    throw e;
  }
  return 'ok';
};
const ID = (c: string) => c.repeat(22);
const SHA = 'A'.repeat(43);

function manifest(entries: BackupManifest['entries'], memories: number, photos: number) {
  return {
    v: 1,
    header: SHA,
    created: '2026-10-31T10:00:00.000Z',
    counts: { memories, photos, missing: 0, unreadable: 0 },
    entries,
  } as const satisfies BackupManifest;
}

describe('prefijo', () => {
  it('ida y vuelta: «MGX1», versión 1 y la longitud de la cabecera', () => {
    const p = encodePrefix(300);
    expect([...p.slice(0, 4)]).toEqual([0x4d, 0x47, 0x58, 0x31]);
    expect(p[4]).toBe(1);
    expect(decodePrefix(p)).toBe(300);
  });

  it('otra firma, versión más nueva, reservado distinto de cero o longitudes imposibles: se rechaza', () => {
    const bad = (mutate: (p: Uint8Array) => void) => {
      const p = encodePrefix(300);
      mutate(p);
      return code(() => decodePrefix(p));
    };
    expect(bad((p) => (p[0] = 0x50))).toBe('format');
    expect(bad((p) => (p[4] = 2))).toBe('version');
    expect(bad((p) => (p[4] = 0))).toBe('format');
    expect(bad((p) => (p[6] = 1))).toBe('format');
    expect(code(() => decodePrefix(encodePrefix(5000)))).toBe('format');
    expect(code(() => decodePrefix(new Uint8Array(4)))).toBe('format');
  });
});

describe('manifiesto', () => {
  const memory = { t: 'memory', id: ID('m'), sv: 1, size: 100, sha256: SHA } as const;
  const photo = { t: 'photo', id: ID('p'), memory: ID('m'), size: 200, sha256: SHA } as const;
  const thumb = {
    t: 'thumb',
    id: ID('t'),
    memory: ID('m'),
    parent: ID('p'),
    size: 50,
    sha256: SHA,
  } as const;

  it('uno coherente pasa y los desplazamientos son acumulados', () => {
    expect(code(() => checkManifest(manifest([memory, photo, thumb], 1, 1)))).toBe('ok');
    expect(layout(1000, [memory, photo, thumb])).toEqual({
      offsets: [1000, 1100, 1300],
      total: 1350,
    });
  });

  it('foto antes de su recuerdo, miniatura de otra foto, ids repetidos o recuentos falsos: `format`', () => {
    expect(code(() => checkManifest(manifest([photo, memory], 1, 1)))).toBe('format');
    expect(
      code(() => checkManifest(manifest([memory, photo, { ...thumb, parent: ID('x') }], 1, 1))),
    ).toBe('format');
    expect(code(() => checkManifest(manifest([memory, memory], 2, 0)))).toBe('format');
    expect(code(() => checkManifest(manifest([memory, photo], 2, 1)))).toBe('format');
    expect(code(() => checkManifest(manifest([memory, photo], 1, 0)))).toBe('format');
  });
});
