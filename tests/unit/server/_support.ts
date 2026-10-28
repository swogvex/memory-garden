import { randomBytes, toB64Url } from '@/server/bytes';
import { handleApi } from '@/server';
import type { ApiEnv } from '@/server';
import { createD1, rows, type SqliteDb, type TestD1 } from './_d1';

/** Secretos y entorno de pruebas. Valores ficticios: no son los de `.dev.vars` ni los de producción. */
export const PEPPER = toB64Url(new Uint8Array(32).fill(0x11));
export const SETUP_CODE = 'ABCDE-FGHJK-MNPQR-STVWX-YZ012';
export const ORIGIN = 'http://localhost:4322';
export const T0 = 1_800_000_000; // segundos Unix fijos

export interface Harness {
  d1: TestD1;
  raw: SqliteDb;
  env: ApiEnv;
  /** Reloj simulado (segundos Unix). */
  clock: { now: number };
  call(method: string, path: string, opts?: CallOptions): Promise<Reply>;
}

export interface CallOptions {
  body?: unknown;
  rawBody?: string;
  cookie?: string | null;
  ip?: string;
  headers?: Record<string, string>;
  /** `false` quita Origin y Content-Type (pruebas de CSRF). */
  defaults?: boolean;
  url?: string;
}

export interface Reply {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  headers: Headers;
  cookies: string[];
}

export function makeHarness(over: Partial<ApiEnv> = {}): Harness {
  const d1 = createD1();
  const env: ApiEnv = { DB: d1.db, PEPPER, SETUP_CODE, MG_ENV: 'local', ...over };
  const clock = { now: T0 };
  async function call(method: string, path: string, opts: CallOptions = {}): Promise<Reply> {
    const headers = new Headers(opts.headers);
    if (opts.defaults !== false) {
      if (!headers.has('Origin')) headers.set('Origin', ORIGIN);
      if (method !== 'GET' && !headers.has('Content-Type'))
        headers.set('Content-Type', 'application/json');
    }
    if (opts.cookie) headers.set('Cookie', opts.cookie);
    if (opts.ip) headers.set('CF-Connecting-IP', opts.ip);
    const init: RequestInit = { method, headers };
    if (method !== 'GET' && method !== 'HEAD')
      init.body = opts.rawBody ?? (opts.body === undefined ? '{}' : JSON.stringify(opts.body));
    const res = await handleApi(new Request(opts.url ?? `${ORIGIN}${path}`, init), env, {
      now: () => clock.now,
    });
    const text = await res.text();
    let json: Record<string, unknown> | null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return {
      status: res.status,
      json,
      text,
      headers: res.headers,
      cookies: res.headers.getSetCookie(),
    };
  }
  return { d1, raw: d1.raw, env, clock, call };
}

// ---- Cargas válidas sintéticas (el servidor solo comprueba forma y cabecera, nunca contenido) ----

export function fakeWrapped(purpose: 'pw' | 'rec'): string {
  const bytes = randomBytes(64);
  bytes.set([0x01, 0x01, purpose === 'pw' ? 0x10 : 0x11, 0x00]);
  return toB64Url(bytes);
}

export function kdfText(iter = 1_500_000): string {
  return `{"v":1,"alg":"pbkdf2-sha256","iter":${iter},"salt":"${toB64Url(randomBytes(16))}"}`;
}

export interface Secrets {
  authPw: string;
  authRec: string;
}

export function setupBody(
  secrets: Secrets,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    setup_code: SETUP_CODE,
    vault_id: toB64Url(randomBytes(16)),
    kdf: kdfText(),
    auth_pw: secrets.authPw,
    rec_salt: toB64Url(randomBytes(16)),
    auth_rec: secrets.authRec,
    wrapped_mk_pw: fakeWrapped('pw'),
    wrapped_mk_rec: fakeWrapped('rec'),
    mk_version: 1,
    ...over,
  };
}

export function newSecrets(): Secrets {
  return { authPw: toB64Url(randomBytes(32)), authRec: toB64Url(randomBytes(32)) };
}

/** Cookie `nombre=valor` a partir de un `Set-Cookie`. */
export function cookieOf(reply: Reply): string {
  const first = reply.cookies[0];
  if (!first) throw new Error('la respuesta no trae Set-Cookie');
  return first.split(';')[0] ?? '';
}

/** Hace el primer acceso y devuelve la sesión resultante. */
export async function doSetup(
  h: Harness,
  secrets = newSecrets(),
): Promise<{ secrets: Secrets; cookie: string; reply: Reply; body: Record<string, unknown> }> {
  const body = setupBody(secrets);
  const reply = await h.call('POST', '/api/setup', { body });
  if (reply.status !== 200) throw new Error(`setup falló: ${reply.status} ${reply.text}`);
  return { secrets, cookie: cookieOf(reply), reply, body };
}

export async function doLogin(
  h: Harness,
  secrets: Secrets,
  opts: CallOptions = {},
): Promise<Reply> {
  return h.call('POST', '/api/auth/login', { body: { auth_pw: secrets.authPw }, ...opts });
}

export function count(raw: SqliteDb, table: string): number {
  return Number(rows<{ n: number }>(raw, `SELECT count(*) AS n FROM ${table}`)[0]?.n ?? 0);
}
