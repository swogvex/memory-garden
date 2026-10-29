import type { D1Like, D1StatementLike } from './d1';

/** Eventos de seguridad: solo tipo y hora, sin IP ni datos personales (data-model.md, D-078). */
export type EventType =
  | 'setup'
  | 'login_ok'
  | 'password_changed'
  | 'recovery_used'
  | 'recovery_key_regenerated'
  | 'kdf_upgraded'
  | 'sessions_revoked';

export function eventStatement(db: D1Like, type: EventType, now: number): D1StatementLike {
  return db
    .prepare('INSERT INTO security_event (type, created_at) VALUES (?1, ?2)')
    .bind(type, now);
}

/**
 * Guardia de concurrencia de los cambios de claves (`key_revision`). Va SIEMPRE la primera de la transacción:
 * si la revisión esperada no coincide, `created_at` vale NULL, la columna es NOT NULL y D1 deshace toda la
 * transacción (nada se aplica a medias). El propio evento de auditoría hace de guardia.
 */
export function guardedEventStatement(
  db: D1Like,
  type: EventType,
  accountId: string,
  expectedRevision: number,
  now: number,
): D1StatementLike {
  return db
    .prepare(
      'INSERT INTO security_event (type, created_at) VALUES (?1, CASE WHEN (SELECT key_revision FROM vault WHERE account_id = ?2) = ?3 THEN ?4 ELSE NULL END)',
    )
    .bind(type, accountId, expectedRevision, now);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : '';
}

/** La guardia de `key_revision` ha abortado la transacción. */
export function isRevisionConflict(err: unknown): boolean {
  return message(err).includes('NOT NULL constraint failed: security_event.created_at');
}

/** Segundo primer acceso: la restricción de unicidad de `account` lo impide (D-001). */
export function isSingletonConflict(err: unknown): boolean {
  const m = message(err);
  return (
    m.includes('UNIQUE constraint failed: account.singleton') ||
    m.includes('UNIQUE constraint failed: account.id')
  );
}

/** Una clave primaria o restricción de unicidad de `table` ya existe. */
export function isUniqueConflict(err: unknown, table: string): boolean {
  return message(err).includes(`UNIQUE constraint failed: ${table}.`);
}

/** Una guarda `CASE … ELSE NULL` sobre `table.column` (NOT NULL) ha abortado la transacción. */
export function isGuardAbort(err: unknown, column: string): boolean {
  return message(err).includes(`NOT NULL constraint failed: ${column}`);
}
