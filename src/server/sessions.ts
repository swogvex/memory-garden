import { b64Exact } from './validate';
import { randomToken } from './bytes';
import { COOKIE_NAME_LOCAL, COOKIE_NAME_STRICT, SESSION, type SessionScope } from './config';
import type { Config } from './env';
import type { D1Like, D1StatementLike } from './d1';
import { hashToken } from './hash';

/** Sesiones en D1 y su cookie (D-055, sessions-and-limits.md §2 y §3). En D1 solo vive SHA-256(token). */
export interface Session {
  tokenHash: string;
  accountId: string;
  scope: SessionScope;
}

export interface CookieSpec {
  name: string;
  secure: boolean;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * `__Host-mg_session` con `Secure` en producción y en cualquier host que no sea localhost.
 * El nombre relajado (`mg_session`, sin `Secure`) exige a la vez `MG_ENV=local` (solo en `.dev.vars`) Y host localhost:
 * si falta cualquiera de las dos cosas, se usa la forma estricta (falla cerrado).
 */
export function cookieSpec(cfg: Config, url: URL): CookieSpec {
  return cfg.local && LOCAL_HOSTS.has(url.hostname) && url.protocol === 'http:'
    ? { name: COOKIE_NAME_LOCAL, secure: false }
    : { name: COOKIE_NAME_STRICT, secure: true };
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function setCookie(spec: CookieSpec, token: string, maxAge: number): string {
  return `${spec.name}=${token}; Path=/; ${spec.secure ? 'Secure; ' : ''}HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearCookie(spec: CookieSpec): string {
  return `${spec.name}=; Path=/; ${spec.secure ? 'Secure; ' : ''}HttpOnly; SameSite=Strict; Max-Age=0`;
}

interface SessionRow {
  token_hash: string;
  account_id: string;
  scope: string;
  last_seen_at: number;
  expires_at: number;
}

/**
 * Valida el token de la cookie: existe, no ha caducado en términos absolutos ni por inactividad.
 * Una sesión caducada se borra en el acto. `last_seen_at` se reescribe solo si lleva más de 5 min sin tocarse.
 */
export async function findSession(
  db: D1Like,
  token: string | null,
  now: number,
): Promise<Session | null> {
  if (!token || b64Exact(token, 32) === null) return null;
  const tokenHash = await hashToken(token);
  const row = await db
    .prepare(
      'SELECT token_hash, account_id, scope, last_seen_at, expires_at FROM session WHERE token_hash = ?1',
    )
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row || (row.scope !== 'full' && row.scope !== 'recovery')) return null;
  const { idle, touchAfter } = SESSION[row.scope];
  if (Number(row.expires_at) <= now || now - Number(row.last_seen_at) > idle) {
    await db.prepare('DELETE FROM session WHERE token_hash = ?1').bind(tokenHash).run();
    return null;
  }
  if (now - Number(row.last_seen_at) > touchAfter) {
    await db
      .prepare('UPDATE session SET last_seen_at = ?1 WHERE token_hash = ?2')
      .bind(now, tokenHash)
      .run();
  }
  return { tokenHash, accountId: row.account_id, scope: row.scope };
}

/** Crea el token y la sentencia de alta (para incluirla en una transacción). */
export async function newSession(
  db: D1Like,
  accountId: string,
  scope: SessionScope,
  now: number,
): Promise<{ token: string; maxAge: number; insert: D1StatementLike }> {
  const token = randomToken();
  const maxAge = SESSION[scope].absolute;
  const insert = db
    .prepare(
      'INSERT INTO session (token_hash, account_id, scope, created_at, last_seen_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?4, ?5)',
    )
    .bind(await hashToken(token), accountId, scope, now, now + maxAge);
  return { token, maxAge, insert };
}

export function deleteSessionStatement(db: D1Like, tokenHash: string): D1StatementLike {
  return db.prepare('DELETE FROM session WHERE token_hash = ?1').bind(tokenHash);
}

export function deleteAllSessionsStatement(db: D1Like, accountId: string): D1StatementLike {
  return db.prepare('DELETE FROM session WHERE account_id = ?1').bind(accountId);
}

export function deleteRecoverySessionsStatement(db: D1Like, accountId: string): D1StatementLike {
  return db
    .prepare("DELETE FROM session WHERE account_id = ?1 AND scope = 'recovery'")
    .bind(accountId);
}
