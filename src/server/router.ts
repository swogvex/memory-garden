import {
  changePassword,
  login,
  logout,
  params,
  recover,
  recoveryReset,
  regenerateRecoveryKey,
  setup,
  upgradeKdf,
  type Ctx,
  type Handler,
} from './auth';
import { deleteAsset, getAsset, putAsset } from './assets';
import { MAX_BODY_BYTES } from './config';
import {
  getMemory,
  listMemories,
  purgeMemoryRoute,
  putMemory,
  restoreMemory,
  trashMemory,
  MEMORY_BODY_LIMIT,
} from './memories';
import { loadConfig, type ApiEnv, type Config } from './env';
import { getSettings, getVault, putSettings, SETTINGS_BODY_LIMIT } from './settings';
import { problem, readBodyLimited, toResponse, type ApiResult } from './http';
import { cookieSpec, findSession, readCookie, type Session } from './sessions';
import { isRecord } from './validate';

/**
 * Router único y puerta de autorización de TODO /api/* (D-060, PS-02). Denegar por defecto:
 * una ruta que no esté en `API_ROUTES` no existe; una ruta con `auth` ≠ 'none' no llega a su manejador sin sesión válida.
 * Cada manejador se registra con su exigencia de sesión y la prueba recorre esta tabla entera.
 */
export type RouteAuth = 'none' | 'any' | 'full' | 'recovery';
export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface Route {
  method: Method;
  path: string;
  auth: RouteAuth;
  handler: Handler;
  /** `json` (por defecto): el router lee y analiza el cuerpo. `binary`: el manejador lee el cuerpo (fotos). `none`: sin cuerpo. */
  body?: 'json' | 'binary' | 'none';
  /** Tope de bytes del cuerpo JSON (por defecto `MAX_BODY_BYTES`). */
  maxBody?: number;
}

export const API_ROUTES: readonly Route[] = [
  { method: 'GET', path: '/api/auth/params', auth: 'none', handler: params },
  { method: 'POST', path: '/api/setup', auth: 'none', handler: setup },
  { method: 'POST', path: '/api/auth/login', auth: 'none', handler: login },
  { method: 'POST', path: '/api/auth/recover', auth: 'none', handler: recover },
  { method: 'POST', path: '/api/auth/logout', auth: 'any', handler: logout },
  { method: 'PUT', path: '/api/vault/password', auth: 'full', handler: changePassword },
  { method: 'PUT', path: '/api/vault/recovery-key', auth: 'full', handler: regenerateRecoveryKey },
  { method: 'PUT', path: '/api/vault/kdf', auth: 'full', handler: upgradeKdf },
  { method: 'PUT', path: '/api/vault/recovery-reset', auth: 'recovery', handler: recoveryReset },
  { method: 'GET', path: '/api/vault', auth: 'full', handler: getVault, body: 'none' },
  { method: 'GET', path: '/api/vault/settings', auth: 'full', handler: getSettings, body: 'none' },
  {
    method: 'PUT',
    path: '/api/vault/settings',
    auth: 'full',
    handler: putSettings,
    maxBody: SETTINGS_BODY_LIMIT,
  },
  { method: 'GET', path: '/api/memories', auth: 'full', handler: listMemories, body: 'none' },
  { method: 'GET', path: '/api/memories/:id', auth: 'full', handler: getMemory, body: 'none' },
  {
    method: 'PUT',
    path: '/api/memories/:id',
    auth: 'full',
    handler: putMemory,
    maxBody: MEMORY_BODY_LIMIT,
  },
  { method: 'POST', path: '/api/memories/:id/trash', auth: 'full', handler: trashMemory },
  { method: 'POST', path: '/api/memories/:id/restore', auth: 'full', handler: restoreMemory },
  {
    method: 'DELETE',
    path: '/api/memories/:id',
    auth: 'full',
    handler: purgeMemoryRoute,
    body: 'none',
  },
  { method: 'PUT', path: '/api/assets/:id', auth: 'full', handler: putAsset, body: 'binary' },
  { method: 'GET', path: '/api/assets/:id', auth: 'full', handler: getAsset, body: 'none' },
  { method: 'DELETE', path: '/api/assets/:id', auth: 'full', handler: deleteAsset, body: 'none' },
];

/** Casa `/api/memories/:id` con `/api/memories/abc`; devuelve los segmentos `:nombre` o `null`. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i] as string;
    const val = b[i] as string;
    if (seg.startsWith(':')) {
      if (val === '' || val.length > 64) return null;
      out[seg.slice(1)] = val;
    } else if (seg !== val) return null;
  }
  return out;
}

export interface Deps {
  /** Segundos Unix. Inyectable para simular el reloj en las pruebas (caducidad, ventanas). */
  now?: () => number;
}

/** CSRF (sessions-and-limits §6): `Origin` propio; si falta, `Sec-Fetch-Site: same-origin`. */
function originAllowed(request: Request, url: URL, cfg: Config): boolean {
  const origin = request.headers.get('Origin');
  if (origin !== null) return origin === url.origin || cfg.extraOrigins.includes(origin);
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

function scopeAllows(auth: RouteAuth, session: Session): boolean {
  return auth === 'any' || auth === session.scope;
}

async function dispatch(request: Request, env: ApiEnv, deps: Deps): Promise<ApiResult> {
  const cfg = loadConfig(env);
  if (!cfg) return problem('server_error'); // PEPPER ausente o inválido: ni se intenta atender

  const url = new URL(request.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const matches = API_ROUTES.flatMap((r) => {
    const params = matchPath(r.path, path);
    return params ? [{ route: r, params }] : [];
  });
  if (matches.length === 0) return problem('not_found');
  const hit = matches.find((m) => m.route.method === request.method);
  if (!hit)
    return problem('method_not_allowed', {
      headers: { Allow: matches.map((m) => m.route.method).join(', ') },
    });
  const { route, params: pathParams } = hit;
  const bodyKind = route.body ?? 'json';

  if (route.method !== 'GET') {
    if (!originAllowed(request, url, cfg)) return problem('forbidden');
    if (bodyKind !== 'none') {
      const type = (request.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
      if (type !== (bodyKind === 'binary' ? 'application/octet-stream' : 'application/json'))
        return problem('unsupported_media_type');
    }
  }

  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const cookie = cookieSpec(cfg, url);
  const token = readCookie(request.headers.get('Cookie'), cookie.name);

  let session: Session | null = null;
  if (route.auth !== 'none') {
    session = await findSession(env.DB, token, now);
    // Sin cookie, inventada, caducada o de otro ámbito: la MISMA respuesta (PS-02, PS-05).
    if (!session || !scopeAllows(route.auth, session)) return problem('unauthorized');
  }

  let body: Record<string, unknown> = {};
  if (bodyKind === 'json' && route.method !== 'GET') {
    const text = await readBodyLimited(request, route.maxBody ?? MAX_BODY_BYTES);
    if (text === null) return problem('payload_too_large');
    if (text.trim() !== '') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return problem('bad_request');
      }
      if (!isRecord(parsed)) return problem('bad_request');
      body = parsed;
    }
  }

  const ctx: Ctx = {
    db: env.DB,
    cfg,
    now,
    request,
    body,
    token,
    session,
    cookie,
    params: pathParams,
    url,
    r2: env.PHOTOS ?? null,
  };
  return route.handler(ctx);
}

/**
 * Consume el cuerpo que ninguna ruta haya leído (rechazos tempranos: 401, 403, 404, 405, 415). Si se responde sin leerlo,
 * workerd cierra la conexión y la petición siguiente por esa misma conexión puede fallar en desarrollo con «fetch failed».
 * Tope de 16 KiB: más allá se cancela la lectura, sin acumular memoria.
 */
async function drainBody(request: Request): Promise<void> {
  if (!request.body || request.bodyUsed) return;
  try {
    await readBodyLimited(request, MAX_BODY_BYTES);
  } catch {
    // el cliente cortó la conexión: nada que hacer
  }
}

/** Punto de entrada de /api/*. Toda respuesta, error incluido, sale por `toResponse` y lleva las cabeceras de seguridad. */
export async function handleApi(request: Request, env: ApiEnv, deps: Deps = {}): Promise<Response> {
  try {
    const result = await dispatch(request, env, deps);
    await drainBody(request);
    return toResponse(result);
  } catch (err) {
    // Solo el nombre del error: nunca mensaje, SQL, cuerpo ni cabeceras (PS-41, PS-42).
    console.error('mg:error', err instanceof Error ? err.name : 'unknown');
    await drainBody(request);
    return toResponse(problem('server_error'));
  }
}
