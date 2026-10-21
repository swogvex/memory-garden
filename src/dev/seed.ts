import type {
  CreateMemoryInput,
  CreateMemoryResult,
  GardenMemory,
  GardenSource,
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

  for (const payload of buildSeedPayloads()) {
    const id = newId();
    await repo.memories.put(
      {
        id,
        payload: await keyring.sealMemory(id, SCHEMA_VERSION, payload),
        schemaVersion: SCHEMA_VERSION,
        mkVersion: keyring.mkVersion,
        assetIds: [],
      },
      null,
    );
  }

  return {
    async list(): Promise<GardenMemory[]> {
      const records = await repo.memories.list();
      return Promise.all(
        records.map(async (r) => ({
          ...parseMemoryPayload(await keyring.openMemory(r.id, r.schemaVersion, r.payload)),
          id: r.id,
          updatedAt: r.updatedAt,
        })),
      );
    },
    async create(input: CreateMemoryInput): Promise<CreateMemoryResult> {
      if (input.photos.length > MAX_PHOTOS) throw new Error('garden:too_many_photos');
      const memoryId = newId();
      const uploaded: MemoryPayload['photos'] = [];
      const failed: number[] = [];
      const staged: string[] = [];

      const deleteAssets = async (ids: readonly string[]) => {
        const errors: unknown[] = [];
        for (const id of [...ids].reverse()) {
          try {
            await repo.assets.delete(id);
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length > 0) throw new AggregateError(errors, 'garden:asset_cleanup_failed');
      };

      try {
        for (const [index, item] of input.photos.entries()) {
          const assetId = newId();
          const thumbId = newId();
          const photoAssets: string[] = [];
          try {
            await repo.assets.put({
              id: assetId,
              kind: 'photo',
              parentId: null,
              mkVersion: keyring.mkVersion,
              bytes: await keyring.sealAsset(assetId, 'photo', memoryId, item.photo),
            });
            photoAssets.push(assetId);
            await repo.assets.put({
              id: thumbId,
              kind: 'thumb',
              parentId: assetId,
              mkVersion: keyring.mkVersion,
              bytes: await keyring.sealAsset(thumbId, 'thumb', memoryId, item.thumb),
            });
            photoAssets.push(thumbId);
            staged.push(...photoAssets);
            uploaded.push({ assetId, thumbId, alt: item.alt });
          } catch (error) {
            try {
              await deleteAssets(photoAssets);
            } catch (cleanupError) {
              throw new AggregateError(
                [error, cleanupError],
                'garden:photo_upload_cleanup_failed',
                { cause: cleanupError },
              );
            }
            failed.push(index);
          }
        }

        const payload = parseMemoryPayload({ ...input.fields, photos: uploaded });
        const record = await repo.memories.put(
          {
            id: memoryId,
            payload: await keyring.sealMemory(memoryId, SCHEMA_VERSION, payload),
            schemaVersion: SCHEMA_VERSION,
            mkVersion: keyring.mkVersion,
            assetIds: staged,
          },
          null,
        );
        return {
          memory: { ...payload, id: memoryId, updatedAt: record.updatedAt },
          failedPhotos: failed,
        };
      } catch (error) {
        try {
          await deleteAssets(staged);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'garden:create_cleanup_failed', {
            cause: cleanupError,
          });
        }
        throw error;
      }
    },
    lock() {
      keyring.lock();
    },
  };
}
