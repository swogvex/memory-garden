/**
 * Adaptador remoto de la interfaz `Repository` (H7.2b): habla con la API del Worker (`/api/memories`, `/api/assets`).
 * Solo maneja datos CIFRADOS u opacos, igual que el adaptador de desarrollo: las pantallas no cambian.
 *
 * - Misma interfaz, mismos errores (`StorageError`, mensajes fijos). Sin consola, sin almacenamiento del navegador.
 * - Sesión: cookie `HttpOnly` que el navegador envía sola; aquí no se toca ningún secreto. Un 401 avisa con `onUnauthorized`
 *   (la sesión caducó: hay que volver a pedir la contraseña) y se devuelve como `unavailable`.
 * - Red caída o lenta: `unavailable` (tiempo máximo por petición). La subida de recuerdos reintenta UNA vez si la
 *   respuesta se perdió y reconoce que su propio guardado ya se había aplicado (reintento idempotente).
 * - `vault` (claves y ajustes) NO está en H7.2: lo conectan el acceso y el primer acceso en H7.3.
 */
import { StorageError, type StorageErrorCode } from '@/lib/storage/errors';
import type {
  AssetKind,
  AssetRecord,
  MemoryRecord,
  PutAssetInput,
  PutMemoryInput,
  Repository,
  VaultRepository,
} from '@/lib/storage/types';

export interface RemoteOptions {
  /** Origen de la API. Por defecto, el mismo origen de la página (cadena vacía). */
  readonly baseUrl?: string;
  /** `fetch` inyectable (pruebas). */
  readonly fetch?: typeof fetch;
  /** Se llama cuando el servidor responde 401: la sesión ya no vale. */
  readonly onUnauthorized?: () => void;
  /** Reloj en milisegundos (inyectable en pruebas). */
  readonly now?: () => number;
  /** Tiempo máximo de una petición JSON (ms). */
  readonly timeoutMs?: number;
  /** Tiempo máximo de una subida de foto (ms). */
  readonly uploadTimeoutMs?: number;
}

interface WireAsset {
  id: string;
  kind: AssetKind;
  parent_id: string | null;
  size_bytes: number;
  mk_version: number;
  created_at: number;
}

interface WireMemory {
  id: string;
  payload: string;
  schema_version: number;
  mk_version: number;
  revision: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  assets?: WireAsset[];
}

interface Reply {
  status: number;
  body: unknown;
}

const MAX_PAGES = 250; // 250 × 100 = 25 000 ≥ tope de 20 000 recuerdos

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toMemory(w: WireMemory): MemoryRecord {
  return {
    id: w.id,
    payload: w.payload,
    schemaVersion: w.schema_version,
    mkVersion: w.mk_version,
    revision: w.revision,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    deletedAt: w.deleted_at,
  };
}

function toAsset(memoryId: string, w: WireAsset): AssetRecord {
  return {
    id: w.id,
    memoryId,
    parentId: w.parent_id,
    kind: w.kind,
    sizeBytes: w.size_bytes,
    mkVersion: w.mk_version,
    state: 'ready',
    createdAt: w.created_at,
  };
}

/** Respuesta rara o de otra forma = el servidor no es el esperado: nunca se fía a ciegas. */
function asMemory(v: unknown): WireMemory {
  if (
    !isObject(v) ||
    typeof v.id !== 'string' ||
    typeof v.payload !== 'string' ||
    typeof v.revision !== 'number' ||
    typeof v.updated_at !== 'number' ||
    typeof v.created_at !== 'number' ||
    typeof v.schema_version !== 'number' ||
    typeof v.mk_version !== 'number' ||
    (v.deleted_at !== null && typeof v.deleted_at !== 'number')
  ) {
    throw new StorageError('unavailable');
  }
  return v as unknown as WireMemory;
}

function errorFor(reply: Reply, context: 'memory-write' | 'other'): StorageError {
  const { status } = reply;
  let code: StorageErrorCode;
  if (status === 404)
    code = context === 'memory-write' ? 'conflict' : 'not_found'; // mismo criterio que el adaptador de desarrollo
  else if (status === 409) code = 'conflict';
  else if (status === 400) code = 'invalid';
  else if (status === 413) code = 'too_large';
  else if (status === 507) code = 'quota';
  else if (status === 429) code = 'quota';
  else code = 'unavailable'; // 401, 403, 411, 415, 5xx…
  return new StorageError(code);
}

export function createRemoteRepository(options: RemoteOptions = {}): Repository {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = options.baseUrl ?? '';
  const now = options.now ?? (() => Date.now());
  const timeout = options.timeoutMs ?? 20_000;
  const uploadTimeout = options.uploadTimeoutMs ?? 90_000;
  const sec = (): number => Math.floor(now() / 1000);

  async function send(
    method: string,
    path: string,
    init: { json?: unknown; bytes?: Uint8Array; timeoutMs?: number } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    let body: BodyInit | undefined;
    if (init.bytes) {
      headers['Content-Type'] = 'application/octet-stream';
      body = init.bytes as BodyInit;
    } else if (method === 'POST' || method === 'PUT') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json ?? {});
    }
    let res: Response;
    try {
      res = await doFetch(base + path, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(init.timeoutMs ?? timeout),
      });
    } catch {
      throw new StorageError('unavailable'); // sin red, cortada, tiempo agotado o redirección
    }
    if (res.status === 401) {
      options.onUnauthorized?.();
      throw new StorageError('unavailable');
    }
    return res;
  }

  async function json(method: string, path: string, init: { json?: unknown } = {}): Promise<Reply> {
    const res = await send(method, path, init);
    const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body };
  }

  const vault: VaultRepository = {
    get: () => Promise.reject(new StorageError('unavailable')),
    create: () => Promise.reject(new StorageError('unavailable')),
    replaceKeys: () => Promise.reject(new StorageError('unavailable')),
    getSettings: () => Promise.reject(new StorageError('unavailable')),
    putSettings: () => Promise.reject(new StorageError('unavailable')),
  };

  async function putMemoryOnce(
    input: PutMemoryInput,
    expectedRevision: number | null,
  ): Promise<Reply> {
    return json('PUT', `/api/memories/${encodeURIComponent(input.id)}`, {
      json: {
        payload: input.payload,
        expected_revision: expectedRevision,
        asset_ids: input.assetIds,
        schema_version: input.schemaVersion,
      },
    });
  }

  /** ¿Es el 409 la prueba de que NUESTRO guardado anterior (cuya respuesta se perdió) ya se aplicó? */
  function appliedAlready(
    reply: Reply,
    input: PutMemoryInput,
    expectedRevision: number | null,
  ): MemoryRecord | null {
    if (reply.status !== 409 || !isObject(reply.body) || !isObject(reply.body.current)) return null;
    const cur = reply.body.current as unknown as WireMemory;
    if (typeof cur.payload !== 'string' || typeof cur.revision !== 'number') return null;
    const sameAssets =
      Array.isArray(cur.assets) &&
      cur.assets.length === input.assetIds.length &&
      cur.assets.every((a) => input.assetIds.includes(a.id));
    const expectedNext = expectedRevision === null ? 1 : expectedRevision + 1;
    return cur.payload === input.payload &&
      cur.revision === expectedNext &&
      cur.deleted_at === null &&
      sameAssets
      ? toMemory(asMemory(cur))
      : null;
  }

  async function getOne(id: string): Promise<MemoryRecord | null> {
    const reply = await json('GET', `/api/memories/${encodeURIComponent(id)}`);
    if (reply.status === 404) return null;
    if (reply.status !== 200) throw errorFor(reply, 'other');
    return toMemory(asMemory(reply.body));
  }

  return {
    vault,

    memories: {
      async list(opts = {}) {
        const since = opts.since ?? -1;
        const out: MemoryRecord[] = [];
        let cursor = { since: Math.max(0, since), after: '' };
        for (let page = 0; page < MAX_PAGES; page++) {
          const q = `since=${cursor.since}&after=${encodeURIComponent(cursor.after)}${opts.includeTrashed === true ? '&trashed=1' : ''}`;
          const reply = await json('GET', `/api/memories?${q}`);
          if (reply.status !== 200 || !isObject(reply.body) || !Array.isArray(reply.body.items))
            throw errorFor(reply, 'other');
          for (const item of reply.body.items) {
            const rec = toMemory(asMemory(item));
            if (rec.updatedAt > since) out.push(rec); // el contrato es «estrictamente posterior»
          }
          const next = reply.body.next;
          if (next === null) return out;
          if (!isObject(next) || typeof next.since !== 'number' || typeof next.after !== 'string')
            throw new StorageError('unavailable');
          cursor = { since: next.since, after: next.after };
        }
        throw new StorageError('unavailable'); // demasiadas páginas: algo va mal
      },

      get: getOne,

      async put(input, expectedRevision) {
        let reply: Reply;
        try {
          reply = await putMemoryOnce(input, expectedRevision);
        } catch (err) {
          // Respuesta perdida: el guardado pudo aplicarse. Se reintenta una vez y se reconoce el propio resultado.
          if (!(err instanceof StorageError) || err.code !== 'unavailable') throw err;
          reply = await putMemoryOnce(input, expectedRevision);
          const mine = appliedAlready(reply, input, expectedRevision);
          if (mine) return mine;
        }
        if (reply.status !== 200 || !isObject(reply.body)) throw errorFor(reply, 'memory-write');
        const b = reply.body;
        if (
          typeof b.revision !== 'number' ||
          typeof b.updated_at !== 'number' ||
          typeof b.created_at !== 'number'
        )
          throw new StorageError('unavailable');
        return {
          id: input.id,
          payload: input.payload,
          schemaVersion: input.schemaVersion,
          mkVersion: input.mkVersion,
          revision: b.revision,
          createdAt: b.created_at,
          updatedAt: b.updated_at,
          deletedAt: null,
        };
      },

      async trash(id, expectedRevision) {
        const reply = await json('POST', `/api/memories/${encodeURIComponent(id)}/trash`, {
          json: { expected_revision: expectedRevision },
        });
        if (reply.status !== 200) throw errorFor(reply, 'other');
        return (await getOne(id)) ?? Promise.reject(new StorageError('not_found'));
      },

      async restore(id, expectedRevision) {
        const reply = await json('POST', `/api/memories/${encodeURIComponent(id)}/restore`, {
          json: { expected_revision: expectedRevision },
        });
        if (reply.status !== 200) throw errorFor(reply, 'other');
        return (await getOne(id)) ?? Promise.reject(new StorageError('not_found'));
      },

      async purge(id) {
        const reply = await json('DELETE', `/api/memories/${encodeURIComponent(id)}`);
        if (reply.status !== 204) throw errorFor(reply, 'other');
      },
    },

    assets: {
      async put(input: PutAssetInput) {
        const parent =
          input.parentId === null ? '' : `&parent=${encodeURIComponent(input.parentId)}`;
        const res = await send(
          'PUT',
          `/api/assets/${encodeURIComponent(input.id)}?kind=${input.kind}${parent}`,
          {
            bytes: input.bytes,
            timeoutMs: uploadTimeout,
          },
        );
        if (res.status !== 201) {
          await res.arrayBuffer().catch(() => undefined);
          throw errorFor({ status: res.status, body: null }, 'other');
        }
        await res.arrayBuffer().catch(() => undefined);
        return {
          id: input.id,
          memoryId: null,
          parentId: input.parentId,
          kind: input.kind,
          sizeBytes: input.bytes.length,
          mkVersion: input.mkVersion,
          state: input.kind === 'avatar' ? 'ready' : 'pending',
          createdAt: sec(),
        } satisfies AssetRecord;
      },

      async getBytes(id) {
        const res = await send('GET', `/api/assets/${encodeURIComponent(id)}`);
        if (res.status !== 200) {
          await res.arrayBuffer().catch(() => undefined);
          throw errorFor({ status: res.status, body: null }, 'other');
        }
        try {
          return new Uint8Array(await res.arrayBuffer());
        } catch {
          throw new StorageError('unavailable'); // se cortó la descarga
        }
      },

      async list(memoryId) {
        const reply = await json('GET', `/api/memories/${encodeURIComponent(memoryId)}`);
        if (reply.status === 404) return [];
        if (reply.status !== 200) throw errorFor(reply, 'other');
        const rec = asMemory(reply.body);
        return (rec.assets ?? []).map((a) => toAsset(memoryId, a));
      },

      async delete(id) {
        const reply = await json('DELETE', `/api/assets/${encodeURIComponent(id)}`);
        if (reply.status !== 204) throw errorFor(reply, 'other');
      },
    },
  };
}
