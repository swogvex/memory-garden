import type { Ctx, Handler } from './auth';
import { lazyCleanup, purgeMemory } from './cleanup';
import {
  LIST_PAGE,
  MAX_ASSETS_PER_MEMORY,
  MAX_MEMORIES,
  MAX_MEMORY_BODY_BYTES,
  MAX_PAYLOAD_CHARS,
  MAX_PHOTOS_PER_MEMORY,
} from './config';
import type { D1Like } from './d1';
import { isGuardAbort, isUniqueConflict } from './events';
import { ok, problem, type ApiResult } from './http';
import { intInRange, isId, memoryPayload } from './validate';

/** Recuerdos (data-model.md §3, photos-and-storage.md §3). El servidor guarda y sirve sobres opacos: nunca los abre. */
export const MEMORY_BODY_LIMIT = MAX_MEMORY_BODY_BYTES;

interface Vault {
  id: string;
  mk_version: number;
}

interface MemoryRow {
  id: string;
  payload: string;
  schema_version: number;
  mk_version: number;
  revision: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface AssetMeta {
  id: string;
  created_at: number;
  kind: string;
  parent_id: string | null;
  size_bytes: number;
  mk_version: number;
}

export async function vaultOf(db: D1Like, accountId: string): Promise<Vault | null> {
  return db
    .prepare('SELECT id, mk_version FROM vault WHERE account_id = ?1')
    .bind(accountId)
    .first<Vault>();
}

function view(row: MemoryRow, assets: AssetMeta[]): Record<string, unknown> {
  return { ...row, assets };
}

async function assetsOf(
  db: D1Like,
  vaultId: string,
  ids: string[],
): Promise<Map<string, AssetMeta[]>> {
  const out = new Map<string, AssetMeta[]>();
  if (ids.length === 0) return out;
  const { results } = await db
    .prepare(
      "SELECT memory_id, id, kind, parent_id, size_bytes, mk_version, created_at FROM asset WHERE vault_id = ?1 AND state = 'ready' AND memory_id IN (SELECT value FROM json_each(?2)) ORDER BY created_at, id",
    )
    .bind(vaultId, JSON.stringify(ids))
    .all<AssetMeta & { memory_id: string }>();
  for (const { memory_id, ...meta } of results ?? []) {
    const list = out.get(memory_id) ?? [];
    list.push(meta);
    out.set(memory_id, list);
  }
  return out;
}

/** GET /api/memories?since=<updated_at>&after=<id>&trashed=1 — paginado por (updated_at, id), sin saltarse empates. */
export const listMemories: Handler = async (ctx) => {
  const vault = await vaultOf(ctx.db, ctx.session!.accountId);
  if (!vault) return problem('not_found');
  const q = ctx.url.searchParams;
  const since = q.has('since') ? Number(q.get('since')) : 0;
  const after = q.get('after') ?? '';
  if (!Number.isInteger(since) || since < 0 || after.length > 22 || !/^[A-Za-z0-9_-]*$/.test(after))
    return problem('bad_request');
  const trashed = q.get('trashed') === '1' ? 1 : 0;
  await lazyCleanup(ctx.db, ctx.r2, vault.id, ctx.now);
  const { results } = await ctx.db
    .prepare(
      'SELECT id, payload, schema_version, mk_version, revision, created_at, updated_at, deleted_at FROM memory WHERE vault_id = ?1 AND (updated_at > ?2 OR (updated_at = ?2 AND id > ?3)) AND (?4 = 1 OR deleted_at IS NULL) ORDER BY updated_at, id LIMIT ?5',
    )
    .bind(vault.id, since, after, trashed, LIST_PAGE + 1)
    .all<MemoryRow>();
  const rows = results ?? [];
  const more = rows.length > LIST_PAGE;
  const page = more ? rows.slice(0, LIST_PAGE) : rows;
  const assets = await assetsOf(
    ctx.db,
    vault.id,
    page.map((r) => r.id),
  );
  const last = page[page.length - 1];
  return ok({
    items: page.map((r) => view(r, assets.get(r.id) ?? [])),
    next: more && last ? { since: last.updated_at, after: last.id } : null,
    server_time: ctx.now,
  });
};

async function loadMemory(ctx: Ctx, vaultId: string, id: string): Promise<MemoryRow | null> {
  return ctx.db
    .prepare(
      'SELECT id, payload, schema_version, mk_version, revision, created_at, updated_at, deleted_at FROM memory WHERE id = ?1 AND vault_id = ?2',
    )
    .bind(id, vaultId)
    .first<MemoryRow>();
}

/** GET /api/memories/:id — 404 idéntico si no existe o no es tuyo. */
export const getMemory: Handler = async (ctx) => {
  const id = ctx.params.id;
  const vault = await vaultOf(ctx.db, ctx.session!.accountId);
  if (!isId(id) || !vault) return problem('not_found');
  const row = await loadMemory(ctx, vault.id, id);
  if (!row) return problem('not_found');
  const assets = await assetsOf(ctx.db, vault.id, [id]);
  return ok(view(row, assets.get(id) ?? []));
};

interface Parsed {
  payload: string;
  expected: number | null;
  assetIds: string[];
  schema: number;
}

function parsePut(ctx: Ctx, mkVersion: number): Parsed | null {
  const b = ctx.body;
  const payload = memoryPayload(b.payload, mkVersion, MAX_PAYLOAD_CHARS);
  const expected =
    b.expected_revision === null ? null : intInRange(b.expected_revision, 1, 2_147_483_647);
  if (b.expected_revision !== null && expected === null) return null;
  const schema = b.schema_version === undefined ? 1 : intInRange(b.schema_version, 1, 1000);
  const ids = b.asset_ids === undefined ? [] : b.asset_ids;
  if (!payload || schema === null || !Array.isArray(ids)) return null;
  if (ids.length > MAX_ASSETS_PER_MEMORY || !ids.every(isId) || new Set(ids).size !== ids.length)
    return null;
  return { payload, expected, assetIds: ids as string[], schema };
}

/**
 * PUT /api/memories/:id  { payload, expected_revision: null|n, asset_ids: [...], schema_version? }
 * Crea (`null`) o actualiza (`n`). Todo en UNA transacción de D1: el recuerdo, la liga con sus recursos y las guardas.
 * Una guarda `CASE … ELSE NULL` sobre una columna NOT NULL aborta TODA la transacción (nada queda a medias):
 *   memory.created_at → revisión distinta · memory.updated_at → recursos no válidos · memory.payload → tope de recuerdos.
 */
export const putMemory: Handler = async (ctx) => {
  const id = ctx.params.id;
  const vault = await vaultOf(ctx.db, ctx.session!.accountId);
  if (!isId(id) || !vault) return problem('bad_request');
  const p = parsePut(ctx, vault.mk_version);
  if (!p) return problem('bad_request');
  const { db, now } = ctx;

  // Lectura previa (mensajes claros); la transacción vuelve a comprobarlo todo de forma atómica.
  const current = await loadMemory(ctx, vault.id, id);
  if (p.expected === null && current)
    return problem('conflict', { body: { current: await currentView(ctx, vault.id, current) } });
  if (p.expected !== null && !current) return problem('not_found');
  if (current && (current.revision !== p.expected || current.deleted_at !== null)) {
    return problem('conflict', { body: { current: await currentView(ctx, vault.id, current) } });
  }

  // Recursos pedidos: todos deben ser nuestros, pendientes (o ya ligados a este mismo recuerdo), foto/miniatura.
  const idsJson = JSON.stringify(p.assetIds);
  const { results } = await db
    .prepare(
      'SELECT id, kind, parent_id, state, memory_id FROM asset WHERE vault_id = ?1 AND id IN (SELECT value FROM json_each(?2))',
    )
    .bind(vault.id, idsJson)
    .all<{
      id: string;
      kind: string;
      parent_id: string | null;
      state: string;
      memory_id: string | null;
    }>();
  const found = results ?? [];
  const byId = new Map(found.map((a) => [a.id, a]));
  const valid =
    found.length === p.assetIds.length &&
    found.every(
      (a) =>
        (a.kind === 'photo' || a.kind === 'thumb') &&
        (a.state === 'pending' ? a.memory_id === null : a.state === 'ready' && a.memory_id === id),
    ) &&
    found.every(
      (a) =>
        a.kind !== 'thumb' || (a.parent_id !== null && byId.get(a.parent_id)?.kind === 'photo'),
    ) &&
    found.filter((a) => a.kind === 'photo').length <= MAX_PHOTOS_PER_MEMORY;
  if (!valid) return problem('bad_request', { body: { reason: 'assets' } });

  const statements = [];
  if (current) {
    statements.push(
      db
        .prepare(
          'UPDATE memory SET created_at = CASE WHEN revision = ?3 AND deleted_at IS NULL THEN created_at ELSE NULL END WHERE id = ?1 AND vault_id = ?2',
        )
        .bind(id, vault.id, p.expected),
      db
        .prepare(
          'UPDATE memory SET payload = ?3, schema_version = ?4, mk_version = ?5, revision = revision + 1, updated_at = ?6 WHERE id = ?1 AND vault_id = ?2',
        )
        .bind(id, vault.id, p.payload, p.schema, vault.mk_version, now),
    );
  } else {
    statements.push(
      db
        .prepare(
          'INSERT INTO memory (id, vault_id, payload, schema_version, mk_version, revision, created_at, updated_at) VALUES (?1, ?2, CASE WHEN (SELECT COUNT(*) FROM memory WHERE vault_id = ?2) < ?3 THEN ?4 ELSE NULL END, ?5, ?6, 1, ?7, ?7)',
        )
        .bind(id, vault.id, MAX_MEMORIES, p.payload, p.schema, vault.mk_version, now),
    );
  }
  statements.push(
    db
      .prepare(
        "UPDATE asset SET memory_id = ?1, state = 'ready' WHERE vault_id = ?2 AND state = 'pending' AND memory_id IS NULL AND id IN (SELECT value FROM json_each(?3))",
      )
      .bind(id, vault.id, idsJson),
    // Los que ya no se piden (foto quitada al editar) pasan a `deleting`: se borran de R2 tras confirmar.
    db
      .prepare(
        "UPDATE asset SET state = 'deleting', deleted_at = ?4 WHERE memory_id = ?1 AND vault_id = ?2 AND state = 'ready' AND id NOT IN (SELECT value FROM json_each(?3))",
      )
      .bind(id, vault.id, idsJson, now),
    db
      .prepare(
        "UPDATE memory SET updated_at = CASE WHEN (SELECT COUNT(*) FROM asset WHERE memory_id = ?1 AND state = 'ready' AND id IN (SELECT value FROM json_each(?3))) = ?4 THEN updated_at ELSE NULL END WHERE id = ?1 AND vault_id = ?2",
      )
      .bind(id, vault.id, idsJson, p.assetIds.length),
  );

  try {
    await db.batch(statements);
  } catch (err) {
    if (
      isUniqueConflict(err, 'memory') ||
      isGuardAbort(err, 'memory.created_at') ||
      isGuardAbort(err, 'memory.updated_at')
    ) {
      const now2 = await loadMemory(ctx, vault.id, id);
      return problem(
        'conflict',
        now2 ? { body: { current: await currentView(ctx, vault.id, now2) } } : {},
      );
    }
    if (isGuardAbort(err, 'memory.payload')) return problem('insufficient_storage');
    throw err;
  }

  if (ctx.r2) await lazyCleanup(db, ctx.r2, vault.id, now);
  const saved = await loadMemory(ctx, vault.id, id);
  return ok({
    id,
    revision: saved?.revision ?? 1,
    created_at: saved?.created_at ?? now,
    updated_at: saved?.updated_at ?? now,
  });
};

async function currentView(
  ctx: Ctx,
  vaultId: string,
  row: MemoryRow,
): Promise<Record<string, unknown>> {
  const assets = await assetsOf(ctx.db, vaultId, [row.id]);
  return view(row, assets.get(row.id) ?? []);
}

/**
 * trash / restore. Con `expected_revision` en el cuerpo (lo envía el cliente remoto) exigen la revisión exacta y que el
 * recuerdo no esté ya en el estado pedido (409, igual que el contrato del repositorio); sin él son idempotentes.
 */
async function move(ctx: Ctx, toTrash: boolean): Promise<ApiResult> {
  const id = ctx.params.id;
  const vault = await vaultOf(ctx.db, ctx.session!.accountId);
  if (!isId(id) || !vault) return problem('not_found');
  const given = ctx.body.expected_revision;
  const expected = given === undefined ? undefined : intInRange(given, 1, 2_147_483_647);
  if (given !== undefined && expected === null) return problem('bad_request');
  const row = await loadMemory(ctx, vault.id, id);
  if (!row) return problem('not_found');
  if (expected !== undefined && row.revision !== expected)
    return problem('conflict', { body: { current: await currentView(ctx, vault.id, row) } });
  if ((row.deleted_at !== null) === toTrash) {
    if (expected !== undefined)
      return problem('conflict', { body: { current: await currentView(ctx, vault.id, row) } });
    return ok({
      id,
      revision: row.revision,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
    }); // ya estaba así
  }
  await ctx.db
    .prepare(
      'UPDATE memory SET deleted_at = ?3, revision = revision + 1, updated_at = ?4 WHERE id = ?1 AND vault_id = ?2 AND revision = ?5 AND (deleted_at IS NOT NULL) = ?6',
    )
    .bind(id, vault.id, toTrash ? ctx.now : null, ctx.now, row.revision, toTrash ? 0 : 1)
    .run();
  const saved = await loadMemory(ctx, vault.id, id);
  if (!saved || saved.revision !== row.revision + 1) return problem('conflict'); // otra petición se adelantó
  return ok({
    id,
    revision: saved.revision,
    created_at: saved.created_at,
    updated_at: saved.updated_at,
    deleted_at: saved.deleted_at,
  });
}

export const trashMemory: Handler = (ctx) => move(ctx, true);
export const restoreMemory: Handler = (ctx) => move(ctx, false);

/** DELETE /api/memories/:id — borrado definitivo; solo desde la papelera (nunca un clic accidental sobre uno visible). */
export const purgeMemoryRoute: Handler = async (ctx) => {
  const id = ctx.params.id;
  const vault = await vaultOf(ctx.db, ctx.session!.accountId);
  if (!isId(id) || !vault) return problem('not_found');
  const row = await loadMemory(ctx, vault.id, id);
  if (!row) return problem('not_found');
  if (row.deleted_at === null) return problem('conflict');
  if (!ctx.r2) return problem('server_error');
  await purgeMemory(ctx.db, ctx.r2, vault.id, id, ctx.now);
  return { status: 204 };
};
