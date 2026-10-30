import type { Bytes } from './bytes';
import { ATTEMPT_WINDOW, BUCKET, DELAYS, DELAY_CAP, GLOBAL, RETENTION } from './config';
import type { D1Like, D1StatementLike } from './d1';
import { ipEpoch, ipFingerprint } from './ip';

/**
 * Límite de intentos con contadores propios en D1 (D-056, sessions-and-limits.md §7).
 * Autoridad del servidor: retardo progresivo por IP (huella temporal) y por cuenta, y un cubo global.
 * Nunca hay bloqueo permanente. El contador sube con una sola sentencia atómica (sin «leer y escribir»),
 * de modo que 50 peticiones en paralelo cuentan 50 fallos, no 1.
 */
export type AttemptKind = 'login' | 'recover' | 'setup';

export interface AttemptGate {
  /** Segundos que faltan para poder intentarlo; 0 = permitido. */
  retryAfter: number;
  ipNow: string;
  ipPrev: string;
  acct: string;
}

const LOAD = 'SELECT bucket, blocked_until FROM login_attempt WHERE bucket IN (?1, ?2, ?3, ?4)';

// Fallo en un cubo con retardo progresivo. ?1 cubo, ?2 ahora, ?3 corte de ventana, ?4..?8 retardos de los fallos 4..8, ?9 tope.
// En un UPSERT todas las expresiones de SET se evalúan con los valores ANTIGUOS de la fila.
const FAIL_PROGRESSIVE = `INSERT INTO login_attempt (bucket, fail_count, window_start, blocked_until, updated_at)
VALUES (?1, 1, ?2, 0, ?2)
ON CONFLICT (bucket) DO UPDATE SET
  window_start = CASE WHEN updated_at <= ?3 THEN ?2 ELSE window_start END,
  fail_count = CASE WHEN updated_at <= ?3 THEN 1 ELSE fail_count + 1 END,
  blocked_until = ?2 + CASE (CASE WHEN updated_at <= ?3 THEN 1 ELSE fail_count + 1 END)
    WHEN 1 THEN 0 WHEN 2 THEN 0 WHEN 3 THEN 0
    WHEN 4 THEN ?4 WHEN 5 THEN ?5 WHEN 6 THEN ?6 WHEN 7 THEN ?7 WHEN 8 THEN ?8
    ELSE ?9 END,
  updated_at = ?2`;

// Cubo global: ventana fija de 1 h; por encima del umbral, cada intento exige `spacing` s desde el último fallo.
// ?1 cubo, ?2 ahora, ?3 corte de ventana, ?4 umbral, ?5 separación.
const FAIL_GLOBAL = `INSERT INTO login_attempt (bucket, fail_count, window_start, blocked_until, updated_at)
VALUES (?1, 1, ?2, 0, ?2)
ON CONFLICT (bucket) DO UPDATE SET
  fail_count = CASE WHEN window_start <= ?3 THEN 1 ELSE fail_count + 1 END,
  blocked_until = CASE WHEN window_start <= ?3 THEN 0 WHEN fail_count + 1 > ?4 THEN ?2 + ?5 ELSE 0 END,
  window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END,
  updated_at = ?2`;

// Alta de «ráfaga de fallos» una sola vez por ventana: cuando el cubo de la cuenta llega a 5.
const BURST_EVENT = `INSERT INTO security_event (type, created_at)
SELECT 'login_fail_burst', ?1 WHERE (SELECT fail_count FROM login_attempt WHERE bucket = ?2) = 5`;

const CLEAR = 'DELETE FROM login_attempt WHERE bucket IN (?1, ?2, ?3)';

export async function openGate(
  db: D1Like,
  pepper: Bytes,
  ip: string | null,
  kind: AttemptKind,
  now: number,
): Promise<AttemptGate> {
  const epoch = ipEpoch(now);
  const [cur, prev] = await Promise.all([
    ipFingerprint(pepper, ip, epoch),
    ipFingerprint(pepper, ip, epoch - 1),
  ]);
  const gate = { ipNow: `ip:${cur}`, ipPrev: `ip:${prev}`, acct: BUCKET[kind] };
  const rows = await db
    .prepare(LOAD)
    .bind(gate.ipNow, gate.ipPrev, gate.acct, BUCKET.global)
    .all<{ bucket: string; blocked_until: number }>();
  const until = Math.max(0, ...(rows.results ?? []).map((r) => Number(r.blocked_until)));
  return { ...gate, retryAfter: Math.max(0, until - now) };
}

/** Sentencias a ejecutar tras un fallo: cubo de IP (actual), cubo de la cuenta y cubo global. */
export function failureStatements(db: D1Like, gate: AttemptGate, now: number): D1StatementLike[] {
  const cut = now - ATTEMPT_WINDOW;
  const progressive = (bucket: string, cap: number) =>
    db
      .prepare(FAIL_PROGRESSIVE)
      .bind(bucket, now, cut, DELAYS[4], DELAYS[5], DELAYS[6], DELAYS[7], DELAYS[8], cap);
  return [
    progressive(gate.ipNow, DELAY_CAP.ip),
    progressive(gate.acct, DELAY_CAP.acct),
    db.prepare(FAIL_GLOBAL).bind(BUCKET.global, now, cut, GLOBAL.threshold, GLOBAL.spacing),
    db.prepare(BURST_EVENT).bind(now, gate.acct),
  ];
}

/** Un acceso correcto reinicia los cubos de la IP y de la cuenta (no el global). */
export function successStatements(db: D1Like, gate: AttemptGate): D1StatementLike[] {
  return [db.prepare(CLEAR).bind(gate.ipNow, gate.ipPrev, gate.acct)];
}

/** Purga perezosa (data-model §7.6): contadores de más de 24 h y eventos de más de 180 días. */
export function retentionStatements(db: D1Like, now: number): D1StatementLike[] {
  return [
    db.prepare('DELETE FROM session WHERE expires_at <= ?1').bind(now),
    db
      .prepare('DELETE FROM login_attempt WHERE updated_at <= ?1')
      .bind(now - RETENTION.loginAttempt),
    db
      .prepare('DELETE FROM security_event WHERE created_at <= ?1')
      .bind(now - RETENTION.securityEvent),
  ];
}
