/**
 * `GardenSource` sobre cualquier `Repository` y un `Keyring`: la usa la versión de producción (repositorio remoto).
 * Es la misma lógica que la fuente de desarrollo (`src/dev/seed.ts`) más la resolución de conflictos entre dispositivos (D-188).
 * Cifra y valida aquí; el repositorio solo ve datos cifrados.
 */
import type {
  CreateMemoryInput,
  CreateMemoryResult,
  GardenMemory,
  GardenSource,
  MemoryFields,
  PhotoSlot,
  SaveMemoryInput,
} from '@/features/calendar';
import { newId, type Keyring } from '@/lib/crypto';
import { saveWithResolution } from '@/lib/storage/resolve';
import type { Repository } from '@/lib/storage/types';
import { MAX_PHOTOS, parseMemoryPayload, type MemoryPayload } from '@/lib/validation';

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

export function createGardenSource(repo: Repository, keyring: Keyring): GardenSource {
  const revisions = new Map<string, number>(); // D-145
  const thumbs = createUrlCache(64);
  const fullPhotos = createUrlCache(6);

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
          // D-144: si el recurso ya no existe, se descarta sin avisar.
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
      const input = {
        id,
        payload: await keyring.sealMemory(id, SCHEMA_VERSION, payload),
        schemaVersion: SCHEMA_VERSION,
        mkVersion: keyring.mkVersion,
        assetIds: [...keep, ...staged],
      };
      const { record, notice } =
        expected === null
          ? { record: await repo.memories.put(input, null), notice: null }
          : await saveWithResolution(repo, input, expected);
      // Papelera o borrado desde otro dispositivo: no se resucita (D-188). La pantalla muestra su error de guardado.
      if (!record) throw new Error('garden:remote_changed');
      revisions.set(id, record.revision);
      return {
        memory: { ...payload, id, updatedAt: record.updatedAt },
        failedPhotos: failed,
        replacedRemote: notice?.kind === 'replaced_remote',
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
        return null; // recurso ausente, sesión caducada o claves bloqueadas
      }
    },
    lock() {
      keyring.lock();
      thumbs.clear();
      fullPhotos.clear();
    },
  };
}
