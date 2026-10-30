import type { AuthClient } from '@/features/access/auth-client';
import { createAuthClient } from '@/features/access/auth-client';
import type { Tuning } from '@/features/access/access-flow';
import { ORIGIN, type Harness } from './server/_support';

/**
 * Parámetros de cifrado rápidos SOLO para pruebas. El servidor exige al menos 600.000 iteraciones, así que no se baja de ahí:
 * cada derivación cuesta unas décimas de segundo.
 */
export const FAST: Tuning = {
  vault: {
    policy: { minIter: 600_000, maxIter: 10_000_000, targetIter: 600_000, algs: ['pbkdf2-sha256'] },
    iter: 600_000,
  },
};

export interface Bridge {
  readonly client: AuthClient;
  readonly fetch: typeof fetch;
  /** Cuerpos enviados (texto), para comprobar qué sale del navegador. */
  readonly sent: string[];
  /** Peticiones hechas: `MÉTODO ruta`. */
  readonly requests: string[];
  /** Cookie de sesión de «este navegador». */
  jar: { cookie: string | null };
  /** Hace que la siguiente petición a `path` se aplique en el servidor pero la respuesta se pierda. */
  loseNextResponse(path: string): void;
  /** Dispositivo distinto con otro navegador (sin cookie) contra el mismo servidor. */
  clone(): Bridge;
}

/** `fetch` que habla con el servidor real de pruebas, con su propio «frasco de cookies». */
export function bridge(h: Harness, ip?: string): Bridge {
  const jar: { cookie: string | null } = { cookie: null };
  const sent: string[] = [];
  const requests: string[] = [];
  const lose = new Set<string>();
  const doFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), ORIGIN);
    const method = (init.method ?? 'GET').toUpperCase();
    requests.push(`${method} ${url.pathname}`);
    const headers = new Headers(init.headers);
    const opts: Parameters<Harness['call']>[2] = { headers: Object.fromEntries(headers.entries()) };
    if (jar.cookie) opts.cookie = jar.cookie;
    if (ip) opts.ip = ip;
    if (init.body instanceof Uint8Array) {
      opts.bytes = init.body;
    } else if (typeof init.body === 'string') {
      opts.rawBody = init.body;
      sent.push(init.body);
    }
    const reply = await h.call(method, url.pathname + url.search, opts);
    for (const c of reply.cookies) {
      const pair = c.split(';')[0] ?? '';
      jar.cookie = /Max-Age=0/i.test(c) ? null : pair;
    }
    if (lose.delete(url.pathname)) throw new TypeError('network');
    const status = reply.status;
    return new Response(
      status === 204 ? null : reply.bytes.length ? (reply.bytes as BodyInit) : null,
      { status, headers: reply.headers },
    );
  }) as typeof fetch;
  const self: Bridge = {
    client: createAuthClient({ fetch: doFetch }),
    fetch: doFetch,
    sent,
    requests,
    jar,
    loseNextResponse: (path) => void lose.add(path),
    clone: () => bridge(h, ip),
  };
  return self;
}
