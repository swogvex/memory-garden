import { constantTimeEqual, fromB64Url, randomId, utf8 } from './bytes';
import type { D1Like } from './d1';
import { normalizeCode, type Config } from './env';
import {
  eventStatement,
  guardedEventStatement,
  isRevisionConflict,
  isSingletonConflict,
} from './events';
import { hashToken, hmacSha256, secretHash } from './hash';
import { ok, problem, rateLimited, type ApiResult } from './http';
import {
  failureStatements,
  openGate,
  retentionStatements,
  successStatements,
  type AttemptGate,
  type AttemptKind,
} from './limiter';
import {
  clearCookie,
  deleteAllSessionsStatement,
  deleteRecoverySessionsStatement,
  deleteSessionStatement,
  newSession,
  setCookie,
  type CookieSpec,
  type Session,
} from './sessions';
import { b64Exact, intInRange, parseKdf, secretBytes, wrappedKey } from './validate';

/**
 * Manejadores de autenticación (crypto-spec.md §8, sessions-and-limits.md). El servidor nunca recibe la contraseña,
 * la clave de recuperación ni la clave maestra: solo `auth_pw`, `auth_rec` (derivados) y envolturas cifradas opacas.
 * Todas las sentencias son literales con parámetros enlazados (PS-01).
 */
export interface Ctx {
  db: D1Like;
  cfg: Config;
  now: number;
  request: Request;
  body: Record<string, unknown>;
  /** Valor crudo de la cookie de sesión, si la hay (para rotarla en el acceso). */
  token: string | null;
  /** Sesión ya validada por el router, o `null` en rutas públicas. */
  session: Session | null;
  cookie: CookieSpec;
}

export type Handler = (ctx: Ctx) => Promise<ApiResult>;

const MAX_REVISION = 2_147_483_647;

const gateFor = (ctx: Ctx, kind: AttemptKind): Promise<AttemptGate> =>
  openGate(ctx.db, ctx.cfg.pepper, ctx.request.headers.get('CF-Connecting-IP'), kind, ctx.now);

/** Fallo de autenticación: se anota en los cubos y se responde igual en todos los casos. */
async function failed(ctx: Ctx, gate: AttemptGate): Promise<ApiResult> {
  await ctx.db.batch(failureStatements(ctx.db, gate, ctx.now));
  return problem('invalid_credentials');
}

/**
 * Comprueba `auth_pw` o `auth_rec` contra el hash guardado. Hace SIEMPRE el mismo trabajo (HMAC, lectura de la cuenta,
 * comparación en tiempo constante), exista o no la cuenta y sea válido o no el formato (PS-22).
 */
async function checkSecret(
  ctx: Ctx,
  which: 'pw' | 'rec',
  provided: unknown,
): Promise<{ ok: boolean; accountId: string | null }> {
  const bytes = secretBytes(provided);
  const computed = await hmacSha256(ctx.cfg.pepper, bytes ?? new Uint8Array(32));
  const account = await ctx.db
    .prepare('SELECT id, auth_hash, recovery_auth_hash FROM account LIMIT 1')
    .first<{ id: string; auth_hash: string; recovery_auth_hash: string }>();
  const storedText = account
    ? which === 'pw'
      ? account.auth_hash
      : account.recovery_auth_hash
    : null;
  const stored =
    (storedText ? fromB64Url(storedText) : null) ??
    (await hmacSha256(ctx.cfg.pepper, utf8('mg1/dummy')));
  const equal = constantTimeEqual(computed, stored);
  return { ok: equal && bytes !== null && account !== null, accountId: account?.id ?? null };
}

function sessionCookie(ctx: Ctx, token: string, maxAge: number): string[] {
  return [setCookie(ctx.cookie, token, maxAge)];
}

// ---------------------------------------------------------------------------------------------------------------
// Rutas públicas

export const params: Handler = async (ctx) => {
  const row = await ctx.db
    .prepare('SELECT kdf, rec_salt FROM vault LIMIT 1')
    .first<{ kdf: string; rec_salt: string }>();
  return ok(
    row
      ? { configured: true, kdf: row.kdf, rec_salt: row.rec_salt }
      : { configured: false, kdf: null, rec_salt: null },
  );
};

/** Primer acceso (crypto-spec §8.1): código de configuración de un solo uso; la cuenta única la garantiza SQL (D-001). */
export const setup: Handler = async (ctx) => {
  const gate = await gateFor(ctx, 'setup');
  if (gate.retryAfter > 0) return rateLimited(gate.retryAfter);

  const provided =
    typeof ctx.body.setup_code === 'string' ? normalizeCode(ctx.body.setup_code) : '';
  const [a, b] = await Promise.all([
    hmacSha256(ctx.cfg.pepper, utf8(`mg1/setup|${provided}`)),
    hmacSha256(ctx.cfg.pepper, utf8(`mg1/setup|${ctx.cfg.setupCode ?? ''}`)),
  ]);
  const codeOk = ctx.cfg.setupCode !== null && constantTimeEqual(a, b);
  const exists = await ctx.db.prepare('SELECT 1 AS x FROM account LIMIT 1').first();
  // Código incorrecto, sin código configurado o espacio ya creado: la misma respuesta genérica (PS-07).
  if (!codeOk || exists) return failed(ctx, gate);

  const vaultId = b64Exact(ctx.body.vault_id, 16);
  const kdf = parseKdf(ctx.body.kdf);
  const authPw = secretBytes(ctx.body.auth_pw);
  const authRec = secretBytes(ctx.body.auth_rec);
  const recSalt = b64Exact(ctx.body.rec_salt, 16);
  const wrappedPw = wrappedKey(ctx.body.wrapped_mk_pw, 'pw');
  const wrappedRec = wrappedKey(ctx.body.wrapped_mk_rec, 'rec');
  const mkVersion = ctx.body.mk_version === undefined ? 1 : intInRange(ctx.body.mk_version, 1, 255);
  if (
    !vaultId ||
    !kdf ||
    !authPw ||
    !authRec ||
    !recSalt ||
    !wrappedPw ||
    !wrappedRec ||
    mkVersion === null
  ) {
    return problem('bad_request');
  }

  const accountId = randomId();
  const { db, now } = ctx;
  const session = await newSession(db, accountId, 'full', now);
  try {
    await db.batch([
      db
        .prepare(
          'INSERT INTO account (id, auth_hash, recovery_auth_hash, pepper_version, created_at, credentials_updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)',
        )
        .bind(
          accountId,
          await secretHash(ctx.cfg.pepper, authPw),
          await secretHash(ctx.cfg.pepper, authRec),
          now,
        ),
      db
        .prepare(
          'INSERT INTO vault (id, account_id, mk_version, kdf, wrapped_mk_pw, rec_salt, wrapped_mk_rec, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)',
        )
        .bind(vaultId, accountId, mkVersion, kdf.text, wrappedPw, recSalt, wrappedRec, now),
      session.insert,
      eventStatement(db, 'setup', now),
      ...successStatements(db, gate),
    ]);
  } catch (err) {
    if (isSingletonConflict(err)) return failed(ctx, gate); // otro primer acceso ganó la carrera
    throw err;
  }
  return ok(
    { vault_id: vaultId, key_revision: 1 },
    { cookies: sessionCookie(ctx, session.token, session.maxAge) },
  );
};

/** Acceso y desbloqueo (crypto-spec §8.2): una sola operación; el límite se comprueba ANTES de verificar. */
export const login: Handler = async (ctx) => {
  const gate = await gateFor(ctx, 'login');
  if (gate.retryAfter > 0) return rateLimited(gate.retryAfter);
  const check = await checkSecret(ctx, 'pw', ctx.body.auth_pw);
  if (!check.ok || !check.accountId) return failed(ctx, gate);

  const { db, now } = ctx;
  const vault = await db
    .prepare(
      'SELECT id, kdf, mk_version, key_revision, wrapped_mk_pw FROM vault WHERE account_id = ?1',
    )
    .bind(check.accountId)
    .first<{
      id: string;
      kdf: string;
      mk_version: number;
      key_revision: number;
      wrapped_mk_pw: string;
    }>();
  if (!vault) return problem('server_error');

  const session = await newSession(db, check.accountId, 'full', now);
  await db.batch([
    ...(ctx.token ? [deleteSessionStatement(db, await hashToken(ctx.token))] : []), // rotación: la cookie anterior deja de valer
    session.insert,
    eventStatement(db, 'login_ok', now),
    ...successStatements(db, gate),
    ...retentionStatements(db, now),
  ]);
  return ok(
    {
      vault_id: vault.id,
      kdf: vault.kdf,
      mk_version: vault.mk_version,
      key_revision: vault.key_revision,
      wrapped_mk_pw: vault.wrapped_mk_pw,
    },
    { cookies: sessionCookie(ctx, session.token, session.maxAge) },
  );
};

/** Recuperación (crypto-spec §8.4): crea una sesión de ámbito `recovery` (15 min) y entrega `wrapped_mk_rec`. */
export const recover: Handler = async (ctx) => {
  const gate = await gateFor(ctx, 'recover');
  if (gate.retryAfter > 0) return rateLimited(gate.retryAfter);
  const check = await checkSecret(ctx, 'rec', ctx.body.auth_rec);
  if (!check.ok || !check.accountId) return failed(ctx, gate);

  const { db, now } = ctx;
  const vault = await db
    .prepare(
      'SELECT id, mk_version, key_revision, rec_salt, wrapped_mk_rec FROM vault WHERE account_id = ?1',
    )
    .bind(check.accountId)
    .first<{
      id: string;
      mk_version: number;
      key_revision: number;
      rec_salt: string;
      wrapped_mk_rec: string;
    }>();
  if (!vault) return problem('server_error');

  const session = await newSession(db, check.accountId, 'recovery', now);
  await db.batch([
    deleteRecoverySessionsStatement(db, check.accountId), // una sola sesión de recuperación a la vez
    ...(ctx.token ? [deleteSessionStatement(db, await hashToken(ctx.token))] : []),
    session.insert,
    ...successStatements(db, gate),
    ...retentionStatements(db, now),
  ]);
  return ok(
    {
      vault_id: vault.id,
      mk_version: vault.mk_version,
      key_revision: vault.key_revision,
      rec_salt: vault.rec_salt,
      wrapped_mk_rec: vault.wrapped_mk_rec,
    },
    { cookies: sessionCookie(ctx, session.token, session.maxAge) },
  );
};

// ---------------------------------------------------------------------------------------------------------------
// Rutas con sesión

export const logout: Handler = async (ctx) => {
  if (!ctx.session) return problem('unauthorized');
  await deleteSessionStatement(ctx.db, ctx.session.tokenHash).run();
  return {
    status: 204,
    cookies: [clearCookie(ctx.cookie)],
    headers: { 'Clear-Site-Data': '"cache", "cookies"' }, // mejor esfuerzo (D-082): no se depende de ello
  };
};

/** Cambio de contraseña (crypto-spec §8.3): verifica la actual, reemplaza credenciales, revoca TODAS las sesiones y rota la propia. */
export const changePassword: Handler = async (ctx) => {
  const s = ctx.session;
  if (!s) return problem('unauthorized');
  const kdf = parseKdf(ctx.body.kdf);
  const authPw = secretBytes(ctx.body.auth_pw);
  const wrappedPw = wrappedKey(ctx.body.wrapped_mk_pw, 'pw');
  const revision = intInRange(ctx.body.expected_key_revision, 1, MAX_REVISION);
  if (!kdf || !authPw || !wrappedPw || revision === null) return problem('bad_request');

  const gate = await gateFor(ctx, 'login');
  if (gate.retryAfter > 0) return rateLimited(gate.retryAfter);
  if (!(await checkSecret(ctx, 'pw', ctx.body.current_auth_pw)).ok) return failed(ctx, gate);

  const { db, now } = ctx;
  const session = await newSession(db, s.accountId, 'full', now);
  try {
    await db.batch([
      guardedEventStatement(db, 'password_changed', s.accountId, revision, now), // SIEMPRE la primera
      db
        .prepare('UPDATE account SET auth_hash = ?1, credentials_updated_at = ?2 WHERE id = ?3')
        .bind(await secretHash(ctx.cfg.pepper, authPw), now, s.accountId),
      db
        .prepare(
          'UPDATE vault SET kdf = ?1, wrapped_mk_pw = ?2, key_revision = key_revision + 1, updated_at = ?3 WHERE account_id = ?4',
        )
        .bind(kdf.text, wrappedPw, now, s.accountId),
      deleteAllSessionsStatement(db, s.accountId),
      session.insert,
      ...successStatements(db, gate),
    ]);
  } catch (err) {
    if (isRevisionConflict(err)) return problem('conflict');
    throw err;
  }
  return ok(
    { key_revision: revision + 1 },
    { cookies: sessionCookie(ctx, session.token, session.maxAge) },
  );
};

/** Regeneración de la clave de recuperación (crypto-spec §8.5): la antigua deja de valer al confirmarse. */
export const regenerateRecoveryKey: Handler = async (ctx) => {
  const s = ctx.session;
  if (!s) return problem('unauthorized');
  const recSalt = b64Exact(ctx.body.rec_salt, 16);
  const authRec = secretBytes(ctx.body.auth_rec);
  const wrappedRec = wrappedKey(ctx.body.wrapped_mk_rec, 'rec');
  const revision = intInRange(ctx.body.expected_key_revision, 1, MAX_REVISION);
  if (!recSalt || !authRec || !wrappedRec || revision === null) return problem('bad_request');

  const gate = await gateFor(ctx, 'login');
  if (gate.retryAfter > 0) return rateLimited(gate.retryAfter);
  if (!(await checkSecret(ctx, 'pw', ctx.body.current_auth_pw)).ok) return failed(ctx, gate);

  const { db, now } = ctx;
  try {
    await db.batch([
      guardedEventStatement(db, 'recovery_key_regenerated', s.accountId, revision, now),
      db
        .prepare(
          'UPDATE account SET recovery_auth_hash = ?1, credentials_updated_at = ?2 WHERE id = ?3',
        )
        .bind(await secretHash(ctx.cfg.pepper, authRec), now, s.accountId),
      db
        .prepare(
          'UPDATE vault SET rec_salt = ?1, wrapped_mk_rec = ?2, key_revision = key_revision + 1, updated_at = ?3 WHERE account_id = ?4',
        )
        .bind(recSalt, wrappedRec, now, s.accountId),
      deleteRecoverySessionsStatement(db, s.accountId), // una sesión abierta con la clave antigua deja de valer
      ...successStatements(db, gate),
    ]);
  } catch (err) {
    if (isRevisionConflict(err)) return problem('conflict');
    throw err;
  }
  return ok({ key_revision: revision + 1 });
};

/** Actualización de parámetros del KDF (crypto-spec §8.6): misma contraseña, sal nueva; nunca a menos iteraciones. */
export const upgradeKdf: Handler = async (ctx) => {
  const s = ctx.session;
  if (!s) return problem('unauthorized');
  const kdf = parseKdf(ctx.body.kdf);
  const authPw = secretBytes(ctx.body.auth_pw);
  const wrappedPw = wrappedKey(ctx.body.wrapped_mk_pw, 'pw');
  const revision = intInRange(ctx.body.expected_key_revision, 1, MAX_REVISION);
  if (!kdf || !authPw || !wrappedPw || revision === null) return problem('bad_request');

  const gate = await gateFor(ctx, 'login');
  if (gate.retryAfter > 0) return rateLimited(gate.retryAfter);
  if (!(await checkSecret(ctx, 'pw', ctx.body.current_auth_pw)).ok) return failed(ctx, gate);

  const { db, now } = ctx;
  const current = await db
    .prepare('SELECT kdf FROM vault WHERE account_id = ?1')
    .bind(s.accountId)
    .first<{ kdf: string }>();
  const old = current ? parseKdf(current.kdf) : null;
  if (!old || kdf.iter < old.iter) return problem('bad_request'); // nunca se rebajan los parámetros

  try {
    await db.batch([
      guardedEventStatement(db, 'kdf_upgraded', s.accountId, revision, now),
      db
        .prepare('UPDATE account SET auth_hash = ?1, credentials_updated_at = ?2 WHERE id = ?3')
        .bind(await secretHash(ctx.cfg.pepper, authPw), now, s.accountId),
      db
        .prepare(
          'UPDATE vault SET kdf = ?1, wrapped_mk_pw = ?2, key_revision = key_revision + 1, updated_at = ?3 WHERE account_id = ?4',
        )
        .bind(kdf.text, wrappedPw, now, s.accountId),
      ...successStatements(db, gate),
    ]);
  } catch (err) {
    if (isRevisionConflict(err)) return problem('conflict');
    throw err;
  }
  return ok({ key_revision: revision + 1 });
};

/** Restablecimiento tras recuperar (crypto-spec §8.4, paso 5): solo con sesión `recovery`; sustituye ambas envolturas. */
export const recoveryReset: Handler = async (ctx) => {
  const s = ctx.session;
  if (!s) return problem('unauthorized');
  const kdf = parseKdf(ctx.body.kdf);
  const authPw = secretBytes(ctx.body.auth_pw);
  const wrappedPw = wrappedKey(ctx.body.wrapped_mk_pw, 'pw');
  const recSalt = b64Exact(ctx.body.rec_salt, 16);
  const authRec = secretBytes(ctx.body.auth_rec);
  const wrappedRec = wrappedKey(ctx.body.wrapped_mk_rec, 'rec');
  const revision = intInRange(ctx.body.expected_key_revision, 1, MAX_REVISION);
  if (!kdf || !authPw || !wrappedPw || !recSalt || !authRec || !wrappedRec || revision === null)
    return problem('bad_request');

  const { db, now } = ctx;
  const session = await newSession(db, s.accountId, 'full', now);
  try {
    await db.batch([
      guardedEventStatement(db, 'recovery_used', s.accountId, revision, now),
      db
        .prepare(
          'UPDATE account SET auth_hash = ?1, recovery_auth_hash = ?2, credentials_updated_at = ?3 WHERE id = ?4',
        )
        .bind(
          await secretHash(ctx.cfg.pepper, authPw),
          await secretHash(ctx.cfg.pepper, authRec),
          now,
          s.accountId,
        ),
      db
        .prepare(
          'UPDATE vault SET kdf = ?1, wrapped_mk_pw = ?2, rec_salt = ?3, wrapped_mk_rec = ?4, key_revision = key_revision + 1, updated_at = ?5 WHERE account_id = ?6',
        )
        .bind(kdf.text, wrappedPw, recSalt, wrappedRec, now, s.accountId),
      deleteAllSessionsStatement(db, s.accountId),
      session.insert,
    ]);
  } catch (err) {
    if (isRevisionConflict(err)) return problem('conflict');
    throw err;
  }
  return ok(
    { key_revision: revision + 1 },
    { cookies: sessionCookie(ctx, session.token, session.maxAge) },
  );
};
