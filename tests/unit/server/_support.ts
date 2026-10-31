import { randomBytes, toB64Url } from '@/server/bytes';
import { handleApi } from '@/server';
import type { ApiEnv } from '@/server';
import { createD1, rows, type SqliteDb, type TestD1 } from './_d1';
import { createR2, type FakeR2 } from './_r2';

/** Secretos y entorno de pruebas. Valores ficticios: no son los de `.dev.vars` ni los de producción. */
export const PEPPER = toB64Url(new Uint8Array(32).fill(0x11));
export const SETUP_CODE = 'ABCDE-FGHJK-MNPQR-STVWX-YZ012';
export const ORIGIN = 'http://localhost:4322';
export const T0 = 1_800_000_000; // segundos Unix fijos
/** Identificador válido (16 bytes) que sustituye a `:id` al llamar a una ruta de la tabla. */
const SAMPLE_ID = toB64Url(new Uint8Array(16).fill(0x22));

export interface Harness {
  d1: TestD1;
  raw: SqliteDb;
  r2: FakeR2;
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
  /** Cuerpo binario (fotos): fija Content-Type octet-stream y Content-Length (salvo `length`). */
  bytes?: Uint8Array;
  /** Content-Length a enviar con `bytes`/`stream`; `null` lo omite. */
  length?: number | null;
  /** Cuerpo en flujo (para simular un corte de conexión). */
  stream?: ReadableStream<Uint8Array>;
}

export interface Reply {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  bytes: Uint8Array;
  headers: Headers;
  cookies: string[];
}

function parseJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function makeHarness(over: Partial<ApiEnv> = {}): Harness {
  const d1 = createD1();
  const r2 = createR2();
  const env: ApiEnv = { DB: d1.db, PHOTOS: r2, PEPPER, SETUP_CODE, MG_ENV: 'local', ...over };
  const clock = { now: T0 };
  async function call(method: string, path: string, opts: CallOptions = {}): Promise<Reply> {
    const headers = new Headers(opts.headers);
    if (opts.defaults !== false) {
      if (!headers.has('Origin')) headers.set('Origin', ORIGIN);
      const binary = opts.bytes !== undefined || opts.stream !== undefined;
      if (method !== 'GET' && !headers.has('Content-Type'))
        headers.set('Content-Type', binary ? 'application/octet-stream' : 'application/json');
    }
    if (opts.bytes !== undefined || opts.stream !== undefined) {
      const len = opts.length === undefined ? opts.bytes?.length : opts.length;
      if (len !== null && len !== undefined && !headers.has('Content-Length'))
        headers.set('Content-Length', String(len));
    }
    if (opts.cookie) headers.set('Cookie', opts.cookie);
    if (opts.ip) headers.set('CF-Connecting-IP', opts.ip);
    const init: RequestInit & { duplex?: 'half' } = { method, headers };
    if (opts.stream) {
      init.body = opts.stream;
      init.duplex = 'half';
    } else if (opts.bytes) init.body = opts.bytes as BodyInit;
    else if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE')
      init.body = opts.rawBody ?? (opts.body === undefined ? '{}' : JSON.stringify(opts.body));
    const res = await handleApi(
      new Request(opts.url ?? `${ORIGIN}${path.replace(':id', SAMPLE_ID)}`, init),
      env,
      { now: () => clock.now },
    );
    const buffer = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(buffer);
    const json = parseJson(text);
    return {
      status: res.status,
      json,
      text,
      bytes: buffer,
      headers: res.headers,
      cookies: res.headers.getSetCookie(),
    };
  }
  return { d1, raw: d1.raw, r2, env, clock, call };
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

// ---- Sobres sintéticos para recuerdos y fotos ----

/** Carga de un recuerdo: cabecera [1,1,1,mk] + relleno aleatorio (el servidor no abre el contenido). */
export function fakePayload(size = 120, mk = 1): string {
  const bytes = randomBytes(size);
  bytes.set([0x01, 0x01, 0x01, mk]);
  return toB64Url(bytes);
}

/** Sobre binario de un recurso: cabecera [1,1,2,mk] + relleno aleatorio. */
export function fakeAsset(size: number, mk = 1): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 65536) bytes.set(randomBytes(Math.min(65536, size - i)), i); // getRandomValues admite 64 KiB por llamada
  bytes.set([0x01, 0x01, 0x02, mk]);
  return bytes;
}

export const newId = (): string => toB64Url(randomBytes(16));

/** Sube un recurso y devuelve su respuesta. */
export function putAssetCall(
  h: Harness,
  cookie: string,
  id: string,
  kind: 'photo' | 'thumb' | 'avatar',
  size = 2000,
  extra = '',
  over: CallOptions = {},
): Promise<Reply> {
  return h.call('PUT', `/api/assets/${id}?kind=${kind}${extra}`, {
    cookie,
    bytes: fakeAsset(size),
    ...over,
  });
}

export function putMemoryCall(
  h: Harness,
  cookie: string,
  id: string,
  over: Record<string, unknown> = {},
): Promise<Reply> {
  return h.call('PUT', `/api/memories/${id}`, {
    cookie,
    body: { payload: fakePayload(), expected_revision: null, asset_ids: [], ...over },
  });
}
