import { LAZY_PURGE_BATCH, PENDING_TTL, SWEEP_BATCH, TRASH_TTL } from './config';
import type { D1Like } from './d1';
import type { R2Like } from './r2';

/**
 * Limpieza (photos-and-storage.md §5, data-model.md §7.6). Orden OBLIGATORIO para no dejar huérfanos ni referencias rotas:
 * 1) las filas ya están marcadas `deleting` (o son `pending` caducadas), 2) se borran los objetos de R2, 3) se borran las filas
 * (miniaturas antes que fotos: la FK es RESTRICT). Si algo falla a medias, la fila `deleting` sigue ahí y la siguiente
 * limpieza lo reintenta; nunca queda una fila `ready` apuntando a un objeto que ya no existe.
 * Sin Cron (D-176): se hace de forma perezosa, con tope de trabajo por petición.
 */
interface AssetRow {
  id: string;
  r2_key: string;
}

export async function removeAssets(db: D1Like, r2: R2Like, rows: AssetRow[]): Promise<void> {
  if (rows.length === 0) return;
  await r2.delete(rows.map((r) => r.r2_key));
  const ids = JSON.stringify(rows.map((r) => r.id));
  await db.batch([
    db
      .prepare("DELETE FROM asset WHERE kind = 'thumb' AND id IN (SELECT value FROM json_each(?1))")
      .bind(ids),
    db
      .prepare(
        "DELETE FROM asset WHERE kind <> 'thumb' AND id IN (SELECT value FROM json_each(?1))",
      )
      .bind(ids),
  ]);
}

/** Borra los recursos `deleting` y las subidas `pending` abandonadas (> 1 h). Devuelve cuántos. */
async function sweepAssets(db: D1Like, r2: R2Like, vaultId: string, now: number): Promise<number> {
  const { results } = await db
    .prepare(
      "SELECT id, r2_key FROM asset WHERE vault_id = ?1 AND (state = 'deleting' OR (state = 'pending' AND created_at < ?2)) ORDER BY created_at LIMIT ?3",
    )
    .bind(vaultId, now - PENDING_TTL, SWEEP_BATCH)
    .all<AssetRow>();
  const rows = results ?? [];
  await removeAssets(db, r2, rows);
  return rows.length;
}

/** Borra definitivamente un recuerdo (ya en papelera) y todos sus recursos. */
export async function purgeMemory(
  db: D1Like,
  r2: R2Like,
  vaultId: string,
  memoryId: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE asset SET state = 'deleting', deleted_at = ?3 WHERE memory_id = ?1 AND vault_id = ?2 AND state <> 'deleting'",
    )
    .bind(memoryId, vaultId, now)
    .run();
  const { results } = await db
    .prepare('SELECT id, r2_key FROM asset WHERE memory_id = ?1 AND vault_id = ?2')
    .bind(memoryId, vaultId)
    .all<AssetRow>();
  await removeAssets(db, r2, results ?? []);
  await db
    .prepare('DELETE FROM memory WHERE id = ?1 AND vault_id = ?2 AND deleted_at IS NOT NULL')
    .bind(memoryId, vaultId)
    .run();
}

/** Papelera caducada (> 30 días): se purga de forma perezosa, unos pocos por petición. */
async function sweepTrash(db: D1Like, r2: R2Like, vaultId: string, now: number): Promise<number> {
  const { results } = await db
    .prepare(
      'SELECT id FROM memory WHERE vault_id = ?1 AND deleted_at IS NOT NULL AND deleted_at < ?2 ORDER BY deleted_at LIMIT ?3',
    )
    .bind(vaultId, now - TRASH_TTL, LAZY_PURGE_BATCH)
    .all<{ id: string }>();
  for (const row of results ?? []) await purgeMemory(db, r2, vaultId, row.id, now);
  return (results ?? []).length;
}

/** Limpieza oportunista: nunca hace fallar la petición que la dispara. */
export async function lazyCleanup(
  db: D1Like,
  r2: R2Like | null,
  vaultId: string,
  now: number,
): Promise<void> {
  if (!r2) return;
  try {
    await sweepAssets(db, r2, vaultId, now);
    await sweepTrash(db, r2, vaultId, now);
  } catch (err) {
    console.error('mg:cleanup', err instanceof Error ? err.name : 'unknown');
  }
}
