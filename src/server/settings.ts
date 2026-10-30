import type { Handler } from './auth';
import { MAX_MEMORY_BODY_BYTES, MAX_PAYLOAD_CHARS } from './config';
import { ok, problem } from './http';
import { intInRange, memoryPayload } from './validate';

/**
 * Ajustes cifrados del espacio (H8.1; data-model.md, columnas `vault.settings_payload` y `vault.settings_revision`).
 * El servidor guarda un sobre opaco con la misma cabecera que un recuerdo ([0x01, 0x01, 0x01 (datos), mk_version]):
 * nunca ve el nombre, el mensaje, el idioma, las categorías ni qué avatar se eligió.
 * Concurrencia optimista: la revisión que se espera viaja en la petición y va también dentro del AAD del sobre
 * (`mg1|settings|<vault_id>|<revisión nueva>`), así que un sobre de otra revisión no se abre en el cliente.
 */
export const SETTINGS_BODY_LIMIT = MAX_MEMORY_BODY_BYTES;
const MAX_REVISION = 2_147_483_647;

interface Row {
  id: string;
  mk_version: number;
  settings_payload: string | null;
  settings_revision: number;
}

async function current(ctx: Parameters<Handler>[0]): Promise<Row | null> {
  return ctx.db
    .prepare(
      'SELECT id, mk_version, settings_payload, settings_revision FROM vault WHERE account_id = ?1',
    )
    .bind(ctx.session!.accountId)
    .first<Row>();
}

const view = (row: Row) => ({ payload: row.settings_payload, revision: row.settings_revision });

/** GET /api/vault/settings → `{ payload: string | null, revision }` (`null` y 0 si aún no se han guardado). */
export const getSettings: Handler = async (ctx) => {
  const row = await current(ctx);
  if (!row) return problem('not_found');
  return ok(view(row));
};

/**
 * PUT /api/vault/settings `{ payload, expected_revision }` → `{ revision }`.
 * 409 con `current` si otra petición guardó antes. La actualización lleva la revisión en el `WHERE`: de dos guardados
 * simultáneos con la misma revisión solo se aplica uno; el otro ve un sobre distinto al suyo y recibe 409.
 */
export const putSettings: Handler = async (ctx) => {
  const row = await current(ctx);
  if (!row) return problem('not_found');
  const payload = memoryPayload(ctx.body.payload, row.mk_version, MAX_PAYLOAD_CHARS);
  const expected = intInRange(ctx.body.expected_revision, 0, MAX_REVISION - 1);
  if (!payload || expected === null) return problem('bad_request');
  if (row.settings_revision !== expected)
    return problem('conflict', { body: { current: view(row) } });

  await ctx.db
    .prepare(
      'UPDATE vault SET settings_payload = ?1, settings_revision = settings_revision + 1, updated_at = ?2 WHERE id = ?3 AND settings_revision = ?4',
    )
    .bind(payload, ctx.now, row.id, expected)
    .run();
  const saved = await current(ctx);
  if (!saved || saved.settings_revision !== expected + 1 || saved.settings_payload !== payload)
    return problem('conflict', saved ? { body: { current: view(saved) } } : {});
  return ok({ revision: saved.settings_revision });
};
