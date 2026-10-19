/**
 * ⚠ SOLO PARA DESARROLLO Y PRUEBAS. ⚠
 * Adaptador en memoria de la interfaz de repositorio: no persiste nada, no autentica nada y no
 * sustituye a D1/R2. Se sustituye por el adaptador remoto en H7 sin tocar las pantallas.
 * Falla a propósito en compilaciones de producción. No se exporta desde `index.ts`.
 */
import { StorageError } from './errors';
import {
  MAX_ASSET_BYTES,
  MAX_ASSETS_PER_MEMORY,
  MAX_PAYLOAD_CHARS,
  MAX_PENDING_ASSETS,
  MAX_PENDING_BYTES,
  MAX_PHOTOS_PER_MEMORY,
  MIN_ASSET_BYTES,
  TOTAL_QUOTA_BYTES,
} from './limits';
import type {
  AssetRecord,
  KeyUpdate,
  MemoryRecord,
  NewVault,
  PutAssetInput,
  PutMemoryInput,
  Repository,
  VaultRecord,
} from './types';

export interface DevAdapterOptions {
  /** Reloj en milisegundos (inyectable en pruebas). */
  readonly now?: () => number;
  readonly quotaBytes?: number;
}

const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const B64U_RE = /^[A-Za-z0-9_-]+$/;

export function createDevMemoryRepository(options: DevAdapterOptions = {}): Repository {
  if ((import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD === true) {
    throw new StorageError('unavailable'); // nunca en producción
  }
  const now = options.now ?? (() => Date.now());
  const quota = options.quotaBytes ?? TOTAL_QUOTA_BYTES;
  const sec = (): number => Math.floor(now() / 1000);

  let vault: VaultRecord | null = null;
  const memories = new Map<string, MemoryRecord>();
  const assets = new Map<string, AssetRecord>();
  const blobs = new Map<string, Uint8Array>();

  const needId = (s: string): void => {
    if (!ID_RE.test(s)) throw new StorageError('invalid');
  };
  const needWire = (s: string | undefined, max = MAX_PAYLOAD_CHARS): void => {
    if (typeof s !== 'string' || s.length === 0 || s.length > max || !B64U_RE.test(s))
      throw new StorageError('invalid');
  };
  const needVault = (): VaultRecord => {
    if (!vault) throw new StorageError('not_found');
    return vault;
  };
  const totalBytes = (): number => [...assets.values()].reduce((n, a) => n + a.sizeBytes, 0);

  return {
    vault: {
      get: async () => (vault ? { ...vault } : null),
      async create(input: NewVault) {
        if (vault) throw new StorageError('conflict');
        needId(input.id);
        needId(input.recSalt);
        needWire(input.wrappedMkPw, 256);
        needWire(input.wrappedMkRec, 256);
        if (typeof input.kdf !== 'string' || input.kdf.length < 40 || input.kdf.length > 400)
          throw new StorageError('invalid');
        const t = sec();
        vault = {
          id: input.id,
          schemaVersion: 1,
          mkVersion: input.mkVersion,
          keyRevision: 1,
          kdf: input.kdf,
          wrappedMkPw: input.wrappedMkPw,
          recSalt: input.recSalt,
          wrappedMkRec: input.wrappedMkRec,
          settingsPayload: null,
          settingsRevision: 0,
          createdAt: t,
          updatedAt: t,
        };
        return { ...vault };
      },
      async replaceKeys(update: KeyUpdate, expectedKeyRevision: number) {
        const v = needVault();
        const pwPair = update.kdf !== undefined || update.wrappedMkPw !== undefined;
        const recPair = update.recSalt !== undefined || update.wrappedMkRec !== undefined;
        if (!pwPair && !recPair) throw new StorageError('invalid');
        if (pwPair && (update.kdf === undefined || update.wrappedMkPw === undefined))
          throw new StorageError('invalid');
        if (recPair && (update.recSalt === undefined || update.wrappedMkRec === undefined))
          throw new StorageError('invalid');
        if (v.keyRevision !== expectedKeyRevision) throw new StorageError('conflict');
        if (pwPair) needWire(update.wrappedMkPw, 256);
        if (recPair) {
          needId(update.recSalt!);
          needWire(update.wrappedMkRec, 256);
        }
        vault = {
          ...v,
          ...(pwPair ? { kdf: update.kdf!, wrappedMkPw: update.wrappedMkPw! } : {}),
          ...(recPair ? { recSalt: update.recSalt!, wrappedMkRec: update.wrappedMkRec! } : {}),
          keyRevision: v.keyRevision + 1,
          updatedAt: sec(),
        };
        return { ...vault };
      },
      async getSettings() {
        const v = needVault();
        return { payload: v.settingsPayload, revision: v.settingsRevision };
      },
      async putSettings(payload: string, expectedRevision: number) {
        const v = needVault();
        needWire(payload);
        if (v.settingsRevision !== expectedRevision) throw new StorageError('conflict');
        vault = {
          ...v,
          settingsPayload: payload,
          settingsRevision: v.settingsRevision + 1,
          updatedAt: sec(),
        };
        return { revision: vault.settingsRevision };
      },
    },

    memories: {
      async list(opts = {}) {
        const since = opts.since ?? -1;
        return [...memories.values()]
          .filter(
            (m) => m.updatedAt > since && (opts.includeTrashed === true || m.deletedAt === null),
          )
          .sort((a, b) => a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : 1))
          .map((m) => ({ ...m }));
      },
      async get(id: string) {
        const m = memories.get(id);
        return m ? { ...m } : null;
      },
      async put(input: PutMemoryInput, expectedRevision: number | null) {
        needVault();
        needId(input.id);
        needWire(input.payload);
        const existing = memories.get(input.id);
        if (
          expectedRevision === null
            ? existing !== undefined
            : existing === undefined || existing.revision !== expectedRevision
        ) {
          throw new StorageError('conflict');
        }
        if (existing && existing.deletedAt !== null) throw new StorageError('conflict');
        if (
          new Set(input.assetIds).size !== input.assetIds.length ||
          input.assetIds.length > MAX_ASSETS_PER_MEMORY
        ) {
          throw new StorageError('invalid');
        }
        const chosen = input.assetIds.map((aid) => {
          const a = assets.get(aid);
          if (!a || a.kind === 'avatar') throw new StorageError('not_found');
          const free = a.state === 'pending' && a.memoryId === null;
          const mine = a.state === 'ready' && a.memoryId === input.id;
          if (!free && !mine) throw new StorageError('conflict'); // ajeno o ya ligado a otro recuerdo
          return a;
        });
        const ids = new Set(input.assetIds);
        if (chosen.filter((a) => a.kind === 'photo').length > MAX_PHOTOS_PER_MEMORY)
          throw new StorageError('quota');
        for (const a of chosen)
          if (a.kind === 'thumb' && (a.parentId === null || !ids.has(a.parentId)))
            throw new StorageError('invalid');
        // Todo validado: ahora se aplica (equivale al `batch` de D1: o todo o nada).
        for (const a of [...assets.values()]) {
          if (a.memoryId === input.id && !ids.has(a.id)) {
            assets.delete(a.id); // desligada: se elimina
            blobs.delete(a.id);
          }
        }
        for (const a of chosen) assets.set(a.id, { ...a, memoryId: input.id, state: 'ready' });
        const t = sec();
        const rec: MemoryRecord = {
          id: input.id,
          payload: input.payload,
          schemaVersion: input.schemaVersion,
          mkVersion: input.mkVersion,
          revision: existing ? existing.revision + 1 : 1,
          createdAt: existing ? existing.createdAt : t,
          updatedAt: t,
          deletedAt: null,
        };
        memories.set(rec.id, rec);
        return { ...rec };
      },
      async trash(id: string, expectedRevision: number) {
        const m = memories.get(id);
        if (!m) throw new StorageError('not_found');
        if (m.revision !== expectedRevision || m.deletedAt !== null)
          throw new StorageError('conflict');
        const t = sec();
        const rec = { ...m, deletedAt: t, updatedAt: t, revision: m.revision + 1 };
        memories.set(id, rec);
        return { ...rec };
      },
      async restore(id: string, expectedRevision: number) {
        const m = memories.get(id);
        if (!m) throw new StorageError('not_found');
        if (m.revision !== expectedRevision || m.deletedAt === null)
          throw new StorageError('conflict');
        const rec = { ...m, deletedAt: null, updatedAt: sec(), revision: m.revision + 1 };
        memories.set(id, rec);
        return { ...rec };
      },
      async purge(id: string) {
        const m = memories.get(id);
        if (!m) throw new StorageError('not_found');
        if (m.deletedAt === null) throw new StorageError('conflict');
        for (const a of [...assets.values()]) {
          if (a.memoryId === id) {
            assets.delete(a.id);
            blobs.delete(a.id);
          }
        }
        memories.delete(id);
      },
    },

    assets: {
      async put(input: PutAssetInput) {
        needVault();
        needId(input.id);
        if (assets.has(input.id)) throw new StorageError('conflict'); // nunca se sobrescribe
        const size = input.bytes.length;
        if (size < MIN_ASSET_BYTES) throw new StorageError('invalid');
        if (size > MAX_ASSET_BYTES[input.kind]) throw new StorageError('too_large');
        if (input.kind === 'thumb') {
          const p = input.parentId === null ? undefined : assets.get(input.parentId);
          if (!p || p.kind !== 'photo') throw new StorageError('invalid');
        } else if (input.parentId !== null) {
          throw new StorageError('invalid');
        }
        const pending = [...assets.values()].filter((a) => a.state === 'pending');
        if (
          input.kind !== 'avatar' &&
          (pending.length >= MAX_PENDING_ASSETS ||
            pending.reduce((n, a) => n + a.sizeBytes, 0) + size > MAX_PENDING_BYTES)
        ) {
          throw new StorageError('quota');
        }
        if (totalBytes() + size > quota) throw new StorageError('quota');
        // Simplificación del adaptador: el avatar queda `ready` de inmediato (H7 define su ligadura).
        const rec: AssetRecord = {
          id: input.id,
          memoryId: null,
          parentId: input.parentId,
          kind: input.kind,
          sizeBytes: size,
          mkVersion: input.mkVersion,
          state: input.kind === 'avatar' ? 'ready' : 'pending',
          createdAt: sec(),
        };
        assets.set(rec.id, rec);
        blobs.set(rec.id, new Uint8Array(input.bytes));
        return { ...rec };
      },
      async getBytes(id: string) {
        const a = assets.get(id);
        const b = blobs.get(id);
        if (!a || !b || a.state !== 'ready') throw new StorageError('not_found');
        return new Uint8Array(b);
      },
      async list(memoryId: string) {
        return [...assets.values()]
          .filter((a) => a.memoryId === memoryId && a.state === 'ready')
          .map((a) => ({ ...a }));
      },
      async delete(id: string) {
        if (!assets.has(id)) throw new StorageError('not_found');
        for (const a of [...assets.values()]) {
          if (a.parentId === id) {
            assets.delete(a.id);
            blobs.delete(a.id);
          }
        }
        assets.delete(id);
        blobs.delete(id);
      },
    },
  };
}
