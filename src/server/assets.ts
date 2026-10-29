import type { Handler } from './auth';
import { removeAssets, lazyCleanup } from './cleanup';
import {
  DAILY_UPLOAD_BYTES,
  MAX_ASSET_BYTES,
  MAX_PENDING_ASSETS,
  MAX_PENDING_BYTES,
  MIN_ASSET_BYTES,
  TOTAL_QUOTA_BYTES,
} from './config';
import { randomBytes, toB64Url } from './bytes';
import { isGuardAbort, isUniqueConflict } from './events';
import { problem, rateLimited, readBytesExact } from './http';
import { vaultOf } from './memories';
import { assetEnvelopeVersion, isId } from './validate';

/**
 * Recursos cifrados: fotos, miniaturas y avatar (photos-and-storage.md §3–§6).
 * Entran y salen SOLO por el Worker (sin URLs prefirmadas, sin acceso público al bucket): cada lectura pasa por la sesión
 * y por la comprobación de propiedad. La clave del objeto en R2 son 256 bits aleatorios sin relación con el id.
 */
type Kind = 'photo' | 'thumb' | 'avatar';
const KINDS: readonly Kind[] = ['photo', 'thumb', 'avatar'];

/** PUT /api/assets/:id?kind=photo|thumb|avatar[&parent=<id de la foto>] — cuerpo: el sobre binario. */
export const putAsset: Handler = async (ctx) => {
  const id = ctx.params.id;
  const kindText = ctx.url.searchParams.get('kind');
  const parent = ctx.url.searchParams.get('parent');
  const vault = await vaultOf(ctx.db, ctx.session!.accountId);
  if (!vault) return problem('not_found');
  if (!ctx.r2) return problem('server_error');
  if (!isId(id) || !KINDS.includes(kindText as Kind)) return problem('bad_request');
  const kind = kindText as Kind;
  if ((kind === 'thumb') !== (parent !== null) || (parent !== null && !isId(parent)))
    return problem('bad_request');

  // Tamaño: obligatorio y comprobado ANTES de leer ni un byte (411 / 413).
  const declared = ctx.request.headers.get('Content-Length');
  if (declared === null) return problem('length_required');
  if (!/^\d{1,9}$/.test(declared)) return problem('bad_request');
  const size = Number(declared);
  if (size > MAX_ASSET_BYTES[kind]) return problem('payload_too_large');
  if (size < MIN_ASSET_BYTES) return problem('bad_request');

  if (parent !== null) {
    const photo = await ctx.db
      .prepare(
        "SELECT 1 AS ok FROM asset WHERE id = ?1 AND vault_id = ?2 AND kind = 'photo' AND state IN ('pending','ready')",
      )
      .bind(parent, vault.id)
      .first();
    if (!photo) return problem('bad_request');
  }

  // El cuerpo real debe medir exactamente lo declarado; si la conexión se corta, no se guarda nada.
  const bytes = await readBytesExact(ctx.request, size);
  if (!bytes) return problem('bad_request');
  if (assetEnvelopeVersion(bytes) !== vault.mk_version) return problem('bad_request');

  await lazyCleanup(ctx.db, ctx.r2, vault.id, ctx.now);

  const r2Key = toB64Url(randomBytes(32));
  const state = kind === 'avatar' ? 'ready' : 'pending';
  // Una sola sentencia: las cuotas se comprueban y la fila se reserva atómicamente (PS-61). Guardas sobre columnas NOT NULL:
  //   size_bytes → demasiadas subidas pendientes · created_at → tope diario · mk_version → cuota total.
  try {
    await ctx.db
      .prepare(
        `INSERT INTO asset (id, vault_id, memory_id, parent_id, kind, r2_key, size_bytes, mk_version, state, created_at)
         VALUES (?1, ?2, NULL, ?3, ?4, ?5,
           CASE WHEN (SELECT COUNT(*) FROM asset WHERE vault_id = ?2 AND state = 'pending') < ?7
                 AND (SELECT COALESCE(SUM(size_bytes), 0) FROM asset WHERE vault_id = ?2 AND state = 'pending') + ?6 <= ?8
                THEN ?6 ELSE NULL END,
           CASE WHEN (SELECT COALESCE(SUM(size_bytes), 0) FROM asset WHERE vault_id = ?2) + ?6 <= ?11 THEN ?12 ELSE NULL END,
           ?13,
           CASE WHEN (SELECT COALESCE(SUM(size_bytes), 0) FROM asset WHERE vault_id = ?2 AND created_at > ?10 - 86400) + ?6 <= ?9
                THEN ?10 ELSE NULL END)`,
      )
      .bind(
        id,
        vault.id,
        parent,
        kind,
        r2Key,
        size,
        MAX_PENDING_ASSETS,
        MAX_PENDING_BYTES,
        DAILY_UPLOAD_BYTES,
        ctx.now,
        TOTAL_QUOTA_BYTES,
        vault.mk_version,
        state,
      )
      .run();
  } catch (err) {
    if (isUniqueConflict(err, 'asset')) return problem('conflict');
    if (isGuardAbort(err, 'asset.size_bytes')) return rateLimited(60);
    if (isGuardAbort(err, 'asset.mk_version')) return problem('insufficient_storage');
    if (isGuardAbort(err, 'asset.created_at')) return rateLimited(3600);
    throw err;
  }

  // Fila reservada ANTES de tocar R2: si R2 falla, se deshace la reserva y no queda ni fila ni objeto.
  try {
    await ctx.r2.put(r2Key, bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
  } catch (err) {
    await ctx.db
      .prepare('DELETE FROM asset WHERE id = ?1 AND vault_id = ?2')
      .bind(id, vault.id)
      .run();
    throw err;
  }
  return { status: 201, body: { id } };
};

/** GET /api/assets/:id — solo `ready`, solo tuyo; 404 idéntico si falta o es ajeno. Sin caché, sin Range, sin tipo deducible. */
export const getAsset: Handler = async (ctx) => {
  const id = ctx.params.id;
  const vault = await vaultOf(ctx.db, ctx.session!.accountId);
  if (!vault || !isId(id) || !ctx.r2)
    return problem(!ctx.r2 && vault ? 'server_error' : 'not_found');
  const row = await ctx.db
    .prepare(
      "SELECT r2_key, size_bytes FROM asset WHERE id = ?1 AND vault_id = ?2 AND state = 'ready'",
    )
    .bind(id, vault.id)
    .first<{ r2_key: string; size_bytes: number }>();
  if (!row) return problem('not_found');
  const object = await ctx.r2.get(row.r2_key);
  if (!object) return problem('not_found');
  return {
    status: 200,
    raw: { body: object.body, size: object.size },
    headers: { 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'none' },
  };
};

/**
 * DELETE /api/assets/:id — solo recursos sin ligar (subida cancelada) o el avatar. Los ligados a un recuerdo
 * se quitan editando el recuerdo (así recuerdo y fotos nunca se desincronizan).
 */
export const deleteAsset: Handler = async (ctx) => {
  const id = ctx.params.id;
  const vault = await vaultOf(ctx.db, ctx.session!.accountId);
  if (!vault || !isId(id)) return problem('not_found');
  if (!ctx.r2) return problem('server_error');
  const row = await ctx.db
    .prepare('SELECT id, r2_key, kind, memory_id FROM asset WHERE id = ?1 AND vault_id = ?2')
    .bind(id, vault.id)
    .first<{ id: string; r2_key: string; kind: string; memory_id: string | null }>();
  if (!row) return problem('not_found');
  if (row.memory_id !== null) return problem('conflict');
  const hasThumb = await ctx.db
    .prepare('SELECT id, r2_key FROM asset WHERE parent_id = ?1 AND vault_id = ?2')
    .bind(id, vault.id)
    .all<{ id: string; r2_key: string }>();
  await ctx.db
    .prepare(
      "UPDATE asset SET state = 'deleting', deleted_at = ?3 WHERE (id = ?1 OR parent_id = ?1) AND vault_id = ?2",
    )
    .bind(id, vault.id, ctx.now)
    .run();
  await removeAssets(ctx.db, ctx.r2, [
    ...(hasThumb.results ?? []),
    { id: row.id, r2_key: row.r2_key },
  ]);
  return { status: 204 };
};
