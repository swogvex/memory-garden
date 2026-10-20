import type { GardenMemory, GardenSource } from '@/features/calendar';
import {
  createVault,
  disposeMaterial,
  newId,
  preparePassword,
  unwrapWithPassword,
} from '@/lib/crypto';
import { createDevMemoryRepository } from '@/lib/storage/dev-memory-adapter';
import { parseMemoryPayload } from '@/lib/validation';
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
    lock() {
      keyring.lock();
    },
  };
}
