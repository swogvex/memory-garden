import { beforeAll, describe, expect, it } from 'vitest';
import type { GardenSource, MemoryFields } from '@/features/calendar';
import { createDevGardenSource } from '@/dev/seed';

const fields: MemoryFields = {
  title: 'Prueba',
  date: '2026-10-06',
  category: 'Viajes',
  text: 'Texto',
  link: null,
  flower: 'girasol',
  season: 'otono',
};
const bytes = (n: number) => new Uint8Array(n).fill(7);
let source: GardenSource;
let baseline = 0;

describe('GardenSource.create (adaptador de desarrollo)', () => {
  beforeAll(async () => {
    source = await createDevGardenSource();
    baseline = (await source.list()).length;
  }, 60_000);

  it('crea un recuerdo sin fotos', async () => {
    const r = await source.create({ fields, photos: [] });
    expect(r.failedPhotos).toEqual([]);
    expect(r.memory).toMatchObject({ title: 'Prueba', photos: [] });
    expect((await source.list()).length).toBe(baseline + 1);
  });

  it('crea un recuerdo con 2 fotos cifradas y miniaturas', async () => {
    const r = await source.create({
      fields,
      photos: [
        { photo: bytes(2000), thumb: bytes(300), alt: 'a' },
        { photo: bytes(2000), thumb: bytes(300), alt: 'b' },
      ],
    });
    expect(r.failedPhotos).toEqual([]);
    expect(r.memory.photos.map((p) => p.alt)).toEqual(['a', 'b']);
    const ids = r.memory.photos.flatMap((p) => [p.assetId, p.thumbId]);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((i) => i.length === 22)).toBe(true);
  });

  it('si una foto no cabe, el recuerdo se guarda sin ella y lo indica', async () => {
    const r = await source.create({
      fields,
      photos: [
        { photo: bytes(2000), thumb: bytes(300), alt: 'ok' },
        { photo: bytes(2 * 1024 * 1024), thumb: bytes(300), alt: 'enorme' },
      ],
    });
    expect(r.failedPhotos).toEqual([1]);
    expect(r.memory.photos.map((p) => p.alt)).toEqual(['ok']);
  });

  it('rechaza más de 5 fotos sin guardar nada', async () => {
    const before = (await source.list()).length;
    const six = Array.from({ length: 6 }, () => ({
      photo: bytes(100),
      thumb: bytes(100),
      alt: '',
    }));
    await expect(source.create({ fields, photos: six })).rejects.toThrow();
    expect((await source.list()).length).toBe(before);
  });
});
