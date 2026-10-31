import { provePassword, setupLockHash, type Ctx, type Handler } from './auth';
import { removeAssets } from './cleanup';
import { ok, problem } from './http';
import { vaultOf } from './memories';
import { clearCookie } from './sessions';
import { secretBytes } from './validate';

/**
 * Operaciones irreversibles de Configuración (data-model.md §7.4, privacy-and-backups.md §9). Las dos exigen sesión
 * completa Y la contraseña actual (`current_auth_pw`, con el límite de intentos del acceso).
 *
 * Trabajan por tandas para no pasar de los límites de una invocación del Worker (consultas a D1 y operaciones de R2):
 * si queda trabajo responden `{ done: false }` y el cliente repite la misma petición. Repetirla es seguro: lo ya borrado
 * no se vuelve a tocar y nada queda a medias (un recurso pasa a `deleting` ANTES de borrar su objeto de R2, y la fila se
 * borra DESPUÉS; así nunca queda una fila `ready` sin objeto ni un objeto sin fila).
 */

/** Claves por llamada a `R2.delete` (máximo de R2) y tandas por petición. */
const R2_BATCH = 1000;
const MAX_BATCHES = 10;

/** Borra hasta `MAX_BATCHES` tandas de recursos (sin el avatar si `onlyMemoryAssets`). `true` si no queda ninguno. */
async function sweep(ctx: Ctx, vaultId: string, onlyMemoryAssets: boolean): Promise<boolean> {
  const r2 = ctx.r2!;
  const memoryOnly = onlyMemoryAssets ? 1 : 0; // ?3 = 1: deja el avatar
  await ctx.db
    .prepare(
      "UPDATE asset SET state = 'deleting', deleted_at = ?2 WHERE vault_id = ?1 AND state <> 'deleting' AND (?3 = 0 OR kind <> 'avatar')",
    )
    .bind(vaultId, ctx.now, memoryOnly)
    .run();
  for (let i = 0; i < MAX_BATCHES; i++) {
    // Miniaturas primero: una foto no se puede borrar mientras su miniatura exista (FK RESTRICT).
    const { results } = await ctx.db
      .prepare(
        "SELECT id, r2_key FROM asset WHERE vault_id = ?1 AND (?3 = 0 OR kind <> 'avatar') ORDER BY (kind = 'thumb') DESC LIMIT ?2",
      )
      .bind(vaultId, R2_BATCH, memoryOnly)
      .all<{ id: string; r2_key: string }>();
    const rows = results ?? [];
    if (rows.length === 0) return true;
    await removeAssets(ctx.db, r2, rows);
  }
  const left = await ctx.db
    .prepare(
      "SELECT 1 AS x FROM asset WHERE vault_id = ?1 AND (?2 = 0 OR kind <> 'avatar') LIMIT 1",
    )
    .bind(vaultId, memoryOnly)
    .first();
  return left === null;
}

/** El cuerpo debe traer una prueba con forma válida; si no, 400 (como los demás cambios de claves). */
function hasProof(ctx: Ctx): boolean {
  return secretBytes(ctx.body.current_auth_pw) !== null;
}

/**
 * POST /api/vault/purge-memories `{ current_auth_pw }` → `{ done }`.
 * Borra PARA SIEMPRE todos los recuerdos (también los de la papelera) y sus fotos. Los ajustes y el avatar se quedan.
 */
export const purgeAllMemories: Handler = async (ctx) => {
  const vault = await vaultOf(ctx.db, ctx.session!.accountId);
  if (!vault) return problem('not_found');
  if (!ctx.r2) return problem('server_error');
  if (!hasProof(ctx)) return problem('bad_request');
  const proof = await provePassword(ctx);
  if (proof) return proof;
  if (!(await sweep(ctx, vault.id, true))) return ok({ done: false });
  await ctx.db.prepare('DELETE FROM memory WHERE vault_id = ?1').bind(vault.id).run();
  return ok({ done: true });
};

/**
 * POST /api/vault/delete `{ current_auth_pw }` → `{ done }`. Elimina el espacio entero (data-model.md §7.4):
 * 1. Gasta el código de configuración vigente (`setup_lock`): desde este momento ya no sirve para crear otro espacio.
 * 2. Borra todos los objetos de R2 del espacio y sus filas.
 * 3. En una transacción: recuerdos, espacio, sesiones, cuenta, contadores de intentos y eventos.
 * Al terminar borra la cookie. Lo que NO puede borrar al instante (Time Travel de D1, exportaciones guardadas) lo explica
 * la interfaz.
 */
export const deleteSpace: Handler = async (ctx) => {
  const s = ctx.session!;
  const vault = await vaultOf(ctx.db, s.accountId);
  if (!vault) return problem('not_found');
  if (!ctx.r2) return problem('server_error');
  if (!hasProof(ctx)) return problem('bad_request');
  const proof = await provePassword(ctx);
  if (proof) return proof;
  const { db, now } = ctx;
  if (ctx.cfg.setupCode !== null)
    await db
      .prepare('INSERT OR IGNORE INTO setup_lock (code_hash, created_at) VALUES (?1, ?2)')
      .bind(await setupLockHash(ctx.cfg.pepper, ctx.cfg.setupCode), now)
      .run();
  if (!(await sweep(ctx, vault.id, false))) return ok({ done: false });
  await db.batch([
    db.prepare('DELETE FROM memory WHERE vault_id = ?1').bind(vault.id),
    db.prepare('DELETE FROM vault WHERE id = ?1').bind(vault.id),
    db.prepare('DELETE FROM session'),
    db.prepare('DELETE FROM account'),
    db.prepare('DELETE FROM login_attempt'),
    db.prepare('DELETE FROM security_event'),
  ]);
  return ok(
    { done: true },
    {
      cookies: [clearCookie(ctx.cookie)],
      headers: { 'Clear-Site-Data': '"cache", "cookies"' },
    },
  );
};
