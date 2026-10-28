import { describe, expect, it } from 'vitest';
import { API_ROUTES, handleApi } from '@/server';
import { toB64Url, randomBytes } from '@/server/bytes';
import {
  T0,
  cookieOf,
  doSetup,
  makeHarness,
  newSecrets,
  type Harness,
  type Reply,
} from './_support';

/** PS-02, PS-05, PS-25, PS-30, PS-31: autorización y protección de origen en CADA ruta de la tabla. */
const UNAUTH = { error: 'unauthorized' };
const PUBLIC = [
  'GET /api/auth/params',
  'POST /api/auth/login',
  'POST /api/auth/recover',
  'POST /api/setup',
];
const protectedRoutes = API_ROUTES.filter((r) => r.auth !== 'none');

async function hit(
  h: Harness,
  r: { method: string; path: string },
  cookie?: string | null,
  body: unknown = {},
): Promise<Reply> {
  return h.call(r.method, r.path, { body, ...(cookie ? { cookie } : {}) });
}

describe('tabla de rutas', () => {
  it('las únicas rutas públicas son las cuatro previstas; añadir una exige tocar esta prueba', () => {
    const open = API_ROUTES.filter((r) => r.auth === 'none')
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(open).toEqual([...PUBLIC].sort());
  });
  it('no hay rutas duplicadas ni fuera de /api/', () => {
    const keys = API_ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of API_ROUTES) expect(r.path.startsWith('/api/')).toBe(true);
  });
  it('ninguna ruta de reinicio, depuración o administración existe (PS-06)', () => {
    for (const r of API_ROUTES)
      expect(r.path).not.toMatch(/\/(reset|debug|dev|admin|wipe|seed|test)(\/|$)/i);
  });
});

describe('acceso sin sesión a cada endpoint protegido (PS-02)', () => {
  it('sin cookie, con cookie inventada, mal formada o con otro nombre: 401 con el MISMO cuerpo', async () => {
    const h = makeHarness();
    await doSetup(h);
    const invented = toB64Url(randomBytes(32));
    for (const r of protectedRoutes) {
      for (const cookie of [
        null,
        `mg_session=${invented}`,
        'mg_session=basura',
        'mg_session=',
        `otra=${invented}`,
        'mg_session=' + 'A'.repeat(500),
      ]) {
        const reply = await hit(h, r, cookie);
        expect(reply.status).toBe(401);
        expect(reply.json).toEqual(UNAUTH);
        expect(reply.cookies).toHaveLength(0);
      }
    }
  });

  it('con la sesión caducada (absoluta o por inactividad): 401', async () => {
    const h = makeHarness();
    const { cookie } = await doSetup(h);
    h.clock.now = T0 + 31 * 60;
    for (const r of protectedRoutes.filter((x) => x.auth !== 'recovery')) {
      const reply = await hit(h, r, cookie);
      expect(reply.status).toBe(401);
      expect(reply.json).toEqual(UNAUTH);
    }
  });

  it('con una sesión de ámbito incorrecto: 401 (PS-05)', async () => {
    const h = makeHarness();
    const { secrets, cookie: full } = await doSetup(h);
    const rec = cookieOf(
      await h.call('POST', '/api/auth/recover', {
        body: { auth_rec: secrets.authRec },
        ip: '198.51.100.7',
      }),
    );
    for (const r of protectedRoutes) {
      if (r.auth === 'full') expect((await hit(h, r, rec)).json).toEqual(UNAUTH);
      if (r.auth === 'recovery') expect((await hit(h, r, full)).json).toEqual(UNAUTH);
    }
  });

  it('con sesión válida del ámbito correcto SÍ llegan al manejador (400 por cuerpo vacío, no 401)', async () => {
    const h = makeHarness();
    const { secrets, cookie: full } = await doSetup(h);
    const rec = cookieOf(
      await h.call('POST', '/api/auth/recover', {
        body: { auth_rec: secrets.authRec },
        ip: '198.51.100.8',
      }),
    );
    for (const r of protectedRoutes.filter((x) => x.path !== '/api/auth/logout')) {
      const reply = await hit(h, r, r.auth === 'recovery' ? rec : full);
      expect(reply.status).toBe(400);
    }
  });
});

describe('rutas y métodos', () => {
  it('ruta desconocida: 404 idéntico con y sin sesión; sin cookie nueva', async () => {
    const h = makeHarness();
    const { cookie } = await doSetup(h);
    for (const path of [
      '/api/nada',
      '/api/memories',
      '/api/',
      '/api/auth',
      '/api/auth/login/extra',
      '/api/dev/reset',
      '/api/reset',
      '/api/debug',
    ]) {
      const a = await h.call('GET', path);
      const b = await h.call('GET', path, { cookie });
      expect(a.status).toBe(404);
      expect(a.json).toEqual({ error: 'not_found' });
      expect(b.json).toEqual(a.json);
    }
  });

  it('método incorrecto: 405 con Allow; OPTIONS y HEAD también (sin CORS)', async () => {
    const h = makeHarness();
    for (const r of API_ROUTES) {
      for (const method of ['OPTIONS', 'HEAD', 'PATCH', r.method === 'GET' ? 'POST' : 'GET']) {
        const reply = await h.call(method, r.path, { body: {} });
        expect(reply.status).toBe(405);
        expect(reply.headers.get('Allow')).toContain(r.method);
        expect(reply.headers.get('Access-Control-Allow-Origin')).toBeNull();
      }
    }
  });

  it('una barra final en la ruta no cambia nada', async () => {
    const h = makeHarness();
    expect((await h.call('GET', '/api/auth/params/')).status).toBe(200);
    expect((await h.call('GET', '/api/auth/params///')).status).toBe(200);
  });
});

describe('CSRF y orígenes (PS-25, PS-31)', () => {
  const stateChanging = API_ROUTES.filter((r) => r.method !== 'GET');

  it('Origin ajeno, «null» o ausente sin Sec-Fetch-Site same-origin: 403 en toda ruta que cambia estado', async () => {
    const h = makeHarness();
    const { cookie } = await doSetup(h);
    for (const r of stateChanging) {
      for (const headers of [
        { Origin: 'https://evil.example' },
        { Origin: 'null' },
        { Origin: 'http://localhost:4323' },
      ]) {
        const reply = await h.call(r.method, r.path, {
          body: {},
          cookie,
          headers,
          defaults: false,
        });
        expect(reply.status).toBe(403);
        expect(reply.json).toEqual({ error: 'forbidden' });
      }
      const none = await h.call(r.method, r.path, {
        body: {},
        cookie,
        headers: { 'Content-Type': 'application/json' },
        defaults: false,
      });
      expect(none.status).toBe(403);
      const cross = await h.call(r.method, r.path, {
        body: {},
        cookie,
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
        defaults: false,
      });
      expect(cross.status).toBe(403);
    }
  });

  it('sin Origin pero con Sec-Fetch-Site: same-origin se acepta', async () => {
    const h = makeHarness();
    const r = await h.call('POST', '/api/auth/login', {
      body: { auth_pw: 'x' },
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      defaults: false,
    });
    expect(r.status).toBe(401);
  });

  it('Content-Type distinto de application/json: 415 (texto, formulario, multipart, ausente)', async () => {
    const h = makeHarness();
    for (const r of stateChanging) {
      for (const ct of [
        'text/plain',
        'application/x-www-form-urlencoded',
        'multipart/form-data; boundary=x',
        '',
      ]) {
        const reply = await h.call(r.method, r.path, {
          rawBody: '{}',
          headers: { Origin: 'http://localhost:4322', ...(ct ? { 'Content-Type': ct } : {}) },
          defaults: false,
        });
        expect(reply.status).toBe(415);
      }
    }
    const withCharset = await h.call('POST', '/api/auth/login', {
      body: {},
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    expect(withCharset.status).toBe(401);
  });

  it('el origen se comprueba ANTES que la sesión: un POST ajeno ni siquiera llega a validar la cookie', async () => {
    const h = makeHarness();
    const r = await h.call('PUT', '/api/vault/kdf', {
      body: {},
      headers: { Origin: 'https://evil.example' },
    });
    expect(r.status).toBe(403);
  });

  it('EXTRA_ORIGINS solo vale con MG_ENV=local', async () => {
    const extra = 'https://abc.devtunnels.ms';
    const local = makeHarness({ EXTRA_ORIGINS: extra });
    expect(
      (await local.call('POST', '/api/auth/login', { body: {}, headers: { Origin: extra } }))
        .status,
    ).toBe(401);
    const prod = makeHarness({ MG_ENV: undefined, EXTRA_ORIGINS: extra });
    expect(
      (await prod.call('POST', '/api/auth/login', { body: {}, headers: { Origin: extra } })).status,
    ).toBe(403);
  });

  it('GET no exige Origin ni cambia estado; ninguna respuesta lleva Access-Control-* (sin CORS)', async () => {
    const h = makeHarness();
    const r = await h.call('GET', '/api/auth/params', {
      defaults: false,
      headers: { Origin: 'https://evil.example' },
    });
    expect(r.status).toBe(200);
    for (const [name] of r.headers)
      expect(name.toLowerCase().startsWith('access-control-')).toBe(false);
  });
});

describe('cuerpos', () => {
  it('JSON ilegible o que no es un objeto: 400; demasiado grande: 413 aunque Content-Length mienta', async () => {
    const h = makeHarness();
    for (const rawBody of ['{no', '[]', '5', 'null', '"x"'])
      expect((await h.call('POST', '/api/auth/login', { rawBody })).status).toBe(400);
    expect(
      (
        await h.call('POST', '/api/auth/login', {
          rawBody: JSON.stringify({ a: 'x'.repeat(17 * 1024) }),
        })
      ).status,
    ).toBe(413);
    const lying = await h.call('POST', '/api/auth/login', {
      rawBody: JSON.stringify({ a: 'x'.repeat(17 * 1024) }),
      headers: { 'Content-Length': '10' },
    });
    expect(lying.status).toBe(413);
    expect((await h.call('POST', '/api/auth/login', { rawBody: '' })).status).toBe(401); // vacío = sin credencial
  });
});

describe('sin redirecciones (PS-30)', () => {
  it('ninguna respuesta redirige ni lleva Location, con parámetros `next` o rutas raras', async () => {
    const h = makeHarness();
    const { secrets } = await doSetup(h);
    const urls = [
      '/api/auth/params?next=https://evil.example',
      '/api/auth/params?next=//evil.example',
      '/api/auth/params?next=/%5Cevil.example',
      '/api/auth/login?next=https://evil.example',
    ];
    for (const u of urls) {
      const get = await h.call('GET', u);
      const post = await h.call('POST', u, {
        body: { auth_pw: secrets.authPw },
        ip: '203.0.113.' + (u.length % 200),
      });
      for (const reply of [get, post]) {
        expect(reply.status >= 300 && reply.status < 400).toBe(false);
        expect(reply.headers.get('Location')).toBeNull();
      }
    }
  });
});

describe('configuración inválida (falla cerrado)', () => {
  it('sin PEPPER o con uno de longitud errónea, todas las rutas responden 500 genérico', async () => {
    for (const PEPPER of [undefined, 'corto', toB64Url(randomBytes(16))]) {
      const h = makeHarness({ PEPPER });
      for (const r of API_ROUTES) {
        const reply = await h.call(r.method, r.path, { body: { auth_pw: newSecrets().authPw } });
        expect(reply.status).toBe(500);
        expect(reply.json).toEqual({ error: 'server_error' });
      }
    }
  });
});

describe('cuerpo siempre consumido', () => {
  it('toda respuesta, también las de rechazo temprano, deja el cuerpo de la petición leído (evita conexiones rotas en desarrollo)', async () => {
    const h = makeHarness();
    const { cookie } = await doSetup(h);
    const cases: { method: string; path: string; headers: Record<string, string> }[] = [
      {
        method: 'PUT',
        path: '/api/vault/password',
        headers: { Origin: 'http://localhost:4322', 'Content-Type': 'application/json' },
      }, // 401 sin sesión
      {
        method: 'POST',
        path: '/api/auth/login',
        headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      }, // 403
      {
        method: 'POST',
        path: '/api/auth/login',
        headers: { Origin: 'http://localhost:4322', 'Content-Type': 'text/plain' },
      }, // 415
      {
        method: 'POST',
        path: '/api/nada',
        headers: { Origin: 'http://localhost:4322', 'Content-Type': 'application/json' },
      }, // 404
      {
        method: 'PATCH',
        path: '/api/auth/login',
        headers: { Origin: 'http://localhost:4322', 'Content-Type': 'application/json' },
      }, // 405
      {
        method: 'PUT',
        path: '/api/vault/kdf',
        headers: {
          Origin: 'http://localhost:4322',
          'Content-Type': 'application/json',
          Cookie: 'mg_session=' + 'A'.repeat(43),
        },
      },
    ];
    void cookie;
    for (const c of cases) {
      const request = new Request('http://localhost:4322' + c.path, {
        method: c.method,
        headers: c.headers,
        body: '{"x":1}',
      });
      const res = await handleApi(request, h.env, { now: () => T0 });
      await res.text();
      expect(res.status >= 400, `${c.method} ${c.path}`).toBe(true);
      expect(request.bodyUsed, `${c.method} ${c.path}: cuerpo sin consumir`).toBe(true);
    }
  });
});
