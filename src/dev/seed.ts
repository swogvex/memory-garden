import type {
  CreateMemoryInput,
  CreateMemoryResult,
  GardenMemory,
  GardenSource,
  MemoryFields,
  PhotoSlot,
  SaveMemoryInput,
} from '@/features/calendar';
import {
  createVault,
  disposeMaterial,
  newId,
  preparePassword,
  unwrapWithPassword,
} from '@/lib/crypto';
import { createDevMemoryRepository } from '@/lib/storage/dev-memory-adapter';
import { MAX_PHOTOS, parseMemoryPayload, type MemoryPayload } from '@/lib/validation';
import { buildSeedPayloads } from './seed-data';

/** Marcador que NO debe aparecer nunca en el bundle de producción (prueba tests/e2e/prod-bundle.spec.ts). */
export const DEV_SEED_MARKER = '__MG_DEV_SEED__';
/** Contraseña del espacio de pruebas: solo existe en memoria, en desarrollo. */
const DEV_PASSWORD = 'Contraseña-solo-de-pruebas-H4-jardín';
const SCHEMA_VERSION = 1;

/** Caché LRU de URL `blob:`: revoca las que expulsa y todas al limpiar (D-142). */
function createUrlCache(max: number) {
  const map = new Map<string, string>();
  const drop = (key: string) => {
    const url = map.get(key);
    if (url !== undefined) URL.revokeObjectURL(url);
    map.delete(key);
  };
  return {
    get(key: string): string | undefined {
      const url = map.get(key);
      if (url !== undefined) {
        map.delete(key);
        map.set(key, url);
      }
      return url;
    },
    set(key: string, url: string): void {
      map.set(key, url);
      while (map.size > max) {
        const oldest = map.keys().next();
        if (oldest.done) break;
        drop(oldest.value);
      }
    },
    clear(): void {
      for (const key of [...map.keys()]) drop(key);
    },
  };
}

/** Espacio cifrado de verdad (PBKDF2 + AES-GCM) sobre el adaptador en memoria. */
export async function createDevGardenSource(): Promise<GardenSource> {
  const repo = createDevMemoryRepository();
  const created = await createVault(DEV_PASSWORD);
  const { wire } = created;
  await repo.vault.create({
    id: wire.vaultId,
    kdf: wire.kdf,
    mkVersion: wire.mkVersion,
    wrappedMkPw: wire.wrappedMkPw,
    recSalt: wire.recSalt,
    wrappedMkRec: wire.wrappedMkRec,
  });
  const material = await preparePassword(DEV_PASSWORD, wire.kdf);
  const keyring = await unwrapWithPassword(material, wire);
  disposeMaterial(material);

  const revisions = new Map<string, number>(); // D-145
  const thumbs = createUrlCache(64);
  const fullPhotos = createUrlCache(6);

  for (const payload of buildSeedPayloads()) {
    const id = newId();
    const record = await repo.memories.put(
      {
        id,
        payload: await keyring.sealMemory(id, SCHEMA_VERSION, payload),
        schemaVersion: SCHEMA_VERSION,
        mkVersion: keyring.mkVersion,
        assetIds: [],
      },
      null,
    );
    revisions.set(id, record.revision);
  }

  /** Crea (`expected = null`) o actualiza un recuerdo. Sube las fotos nuevas de una en una. */
  async function save(
    id: string,
    expected: number | null,
    fields: MemoryFields,
    slots: readonly PhotoSlot[],
  ): Promise<CreateMemoryResult> {
    if (slots.length > MAX_PHOTOS) throw new Error('garden:too_many_photos');
    const owned =
      expected === null
        ? new Set<string>()
        : new Set((await repo.assets.list(id)).map((a) => a.id));
    const refs: MemoryPayload['photos'] = [];
    const keep: string[] = [];
    let staged: string[] = [];
    const failed: number[] = [];
    try {
      for (const [index, slot] of slots.entries()) {
        if (slot.kind === 'kept') {
          // D-144: si el recurso ya no existe (fotos de la semilla), se descarta sin avisar.
          if (owned.has(slot.assetId) && owned.has(slot.thumbId)) {
            refs.push({ assetId: slot.assetId, thumbId: slot.thumbId, alt: slot.alt });
            keep.push(slot.assetId, slot.thumbId);
          }
          continue;
        }
        const assetId = newId();
        const thumbId = newId();
        try {
          await repo.assets.put({
            id: assetId,
            kind: 'photo',
            parentId: null,
            mkVersion: keyring.mkVersion,
            bytes: await keyring.sealAsset(assetId, 'photo', id, slot.photo),
          });
          staged.push(assetId);
          await repo.assets.put({
            id: thumbId,
            kind: 'thumb',
            parentId: assetId,
            mkVersion: keyring.mkVersion,
            bytes: await keyring.sealAsset(thumbId, 'thumb', id, slot.thumb),
          });
          staged.push(thumbId);
          refs.push({ assetId, thumbId, alt: slot.alt });
        } catch {
          failed.push(index);
          await repo.assets.delete(assetId).catch(() => undefined); // borra también su miniatura
          staged = staged.filter((s) => s !== assetId && s !== thumbId);
        }
      }
      const payload = parseMemoryPayload({ ...fields, photos: refs });
      const record = await repo.memories.put(
        {
          id,
          payload: await keyring.sealMemory(id, SCHEMA_VERSION, payload),
          schemaVersion: SCHEMA_VERSION,
          mkVersion: keyring.mkVersion,
          assetIds: [...keep, ...staged],
        },
        expected,
      );
      revisions.set(id, record.revision);
      return {
        memory: { ...payload, id, updatedAt: record.updatedAt },
        failedPhotos: failed,
      };
    } catch (error) {
      for (const assetId of staged) await repo.assets.delete(assetId).catch(() => undefined);
      throw new Error('garden:save_failed', { cause: error });
    }
  }

  return {
    async list(): Promise<GardenMemory[]> {
      const records = await repo.memories.list();
      return Promise.all(
        records.map(async (r) => {
          revisions.set(r.id, r.revision);
          return {
            ...parseMemoryPayload(await keyring.openMemory(r.id, r.schemaVersion, r.payload)),
            id: r.id,
            updatedAt: r.updatedAt,
          };
        }),
      );
    },
    create(input: CreateMemoryInput): Promise<CreateMemoryResult> {
      return save(
        newId(),
        null,
        input.fields,
        input.photos.map((p) => ({ kind: 'new' as const, ...p })),
      );
    },
    update(id: string, input: SaveMemoryInput): Promise<CreateMemoryResult> {
      const revision = revisions.get(id);
      if (revision === undefined) return Promise.reject(new Error('garden:not_found'));
      return save(id, revision, input.fields, input.photos);
    },
    async trash(id: string): Promise<void> {
      const revision = revisions.get(id);
      if (revision === undefined) throw new Error('garden:not_found');
      await repo.memories.trash(id, revision);
      revisions.delete(id);
    },
    async imageUrl(memory, index, size): Promise<string | null> {
      const ref = memory.photos[index];
      if (!ref) return null;
      const assetId = size === 'thumb' ? ref.thumbId : ref.assetId;
      const cache = size === 'thumb' ? thumbs : fullPhotos;
      const hit = cache.get(assetId);
      if (hit) return hit;
      try {
        const bytes = await repo.assets.getBytes(assetId);
        const plain = await keyring.openAsset(
          assetId,
          size === 'thumb' ? 'thumb' : 'photo',
          memory.id,
          bytes,
        );
        const url = URL.createObjectURL(new Blob([plain.slice().buffer], { type: 'image/jpeg' }));
        cache.set(assetId, url);
        return url;
      } catch {
        return null; // recurso ausente o claves bloqueadas
      }
    },
    lock() {
      keyring.lock();
      thumbs.clear();
      fullPhotos.clear();
    },
  };
}
