import { resolveObjectURL } from 'node:buffer';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GardenSource, MemoryFields, PhotoSlot } from '@/features/calendar';
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

describe('GardenSource: actualizar, papelera e imágenes', () => {
  it('imageUrl devuelve la miniatura descifrada; con fotos ausentes, null', async () => {
    const r = await source.create({
      fields,
      photos: [{ photo: bytes(2000), thumb: bytes(300), alt: 'a' }],
    });
    const url = await source.imageUrl(r.memory, 0, 'thumb');
    expect(url?.startsWith('blob:')).toBe(true);
    const blob = resolveObjectURL(url ?? '');
    expect(new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(bytes(300));
    expect(await source.imageUrl(r.memory, 3, 'thumb')).toBeNull();
    expect(
      await source.imageUrl(
        { ...r.memory, photos: [{ assetId: 'x'.repeat(22), thumbId: 'y'.repeat(22), alt: '' }] },
        0,
        'photo',
      ),
    ).toBeNull();
  });

  it('update: conserva una foto, quita otra, añade una nueva y reordena', async () => {
    const created = await source.create({
      fields,
      photos: [
        { photo: bytes(2000), thumb: bytes(300), alt: 'uno' },
        { photo: bytes(2100), thumb: bytes(310), alt: 'dos' },
      ],
    });
    const [first, second] = created.memory.photos;
    const slots: PhotoSlot[] = [
      { kind: 'new', photo: bytes(2200), thumb: bytes(320), alt: 'nueva' },
      { kind: 'kept', assetId: first!.assetId, thumbId: first!.thumbId, alt: 'uno editado' },
    ];
    const r = await source.update(created.memory.id, {
      fields: { ...fields, title: 'Editado' },
      photos: slots,
    });
    expect(r.failedPhotos).toEqual([]);
    expect(r.memory.title).toBe('Editado');
    expect(r.memory.photos.map((p) => p.alt)).toEqual(['nueva', 'uno editado']);
    expect(r.memory.photos[1]?.assetId).toBe(first!.assetId);
    expect(await source.imageUrl(created.memory, 1, 'photo')).toBeNull(); // la quitada ya no existe
    expect(second).toBeDefined();
    const listed = (await source.list()).find((m) => m.id === created.memory.id);
    expect(listed?.title).toBe('Editado');
  });

  it('update: un hueco kept con recursos inexistentes se descarta (D-144)', async () => {
    const created = await source.create({ fields, photos: [] });
    const r = await source.update(created.memory.id, {
      fields,
      photos: [{ kind: 'kept', assetId: 'a'.repeat(22), thumbId: 'b'.repeat(22), alt: 'x' }],
    });
    expect(r.memory.photos).toEqual([]);
    expect(r.failedPhotos).toEqual([]);
  });

  it('update de un id desconocido o con más de 5 fotos falla sin cambiar nada', async () => {
    await expect(source.update('z'.repeat(22), { fields, photos: [] })).rejects.toThrow();
    const created = await source.create({ fields, photos: [] });
    const six: PhotoSlot[] = Array.from({ length: 6 }, () => ({
      kind: 'new',
      photo: bytes(100),
      thumb: bytes(100),
      alt: '',
    }));
    await expect(source.update(created.memory.id, { fields, photos: six })).rejects.toThrow();
  });

  it('trash saca el recuerdo de la lista y no se puede repetir', async () => {
    const created = await source.create({ fields, photos: [] });
    await source.trash(created.memory.id);
    expect((await source.list()).some((m) => m.id === created.memory.id)).toBe(false);
    await expect(source.trash(created.memory.id)).rejects.toThrow();
  });

  it('al bloquear, las imágenes dejan de estar disponibles', async () => {
    const fresh = await createDevGardenSource();
    const r = await fresh.create({
      fields,
      photos: [{ photo: bytes(2000), thumb: bytes(300), alt: 'a' }],
    });
    fresh.lock();
    expect(await fresh.imageUrl(r.memory, 0, 'thumb')).toBeNull();
  }, 60_000);
});
