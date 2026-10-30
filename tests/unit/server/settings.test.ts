import { describe, expect, it } from 'vitest';
import { rows } from './_d1';
import { T0, doSetup, fakePayload, makeHarness } from './_support';

/** H8.1 · ajustes cifrados: el servidor guarda un sobre opaco con revisión optimista (PS-03, PS-04). */
async function ready() {
  const h = makeHarness();
  const { cookie } = await doSetup(h);
  return { h, cookie };
}

const put = (
  h: Awaited<ReturnType<typeof ready>>['h'],
  cookie: string,
  body: Record<string, unknown>,
) => h.call('PUT', '/api/vault/settings', { cookie, body });

describe('leer y guardar', () => {
  it('un espacio recién creado no tiene ajustes: payload null y revisión 0', async () => {
    const { h, cookie } = await ready();
    const r = await h.call('GET', '/api/vault/settings', { cookie });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ payload: null, revision: 0 });
  });

  it('PUT con la revisión esperada guarda el sobre TAL CUAL y sube la revisión', async () => {
    const { h, cookie } = await ready();
    const payload = fakePayload(300);
    const r = await put(h, cookie, { payload, expected_revision: 0 });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ revision: 1 });
    const got = await h.call('GET', '/api/vault/settings', { cookie });
    expect(got.json).toEqual({ payload, revision: 1 });
    const db = rows<{ settings_payload: string; updated_at: number }>(
      h.raw,
      'SELECT settings_payload, updated_at FROM vault',
    )[0];
    expect(db?.settings_payload).toBe(payload);
    expect(db?.updated_at).toBe(T0);
  });

  it('revisión obsoleta: 409 con la versión actual y sin cambios', async () => {
    const { h, cookie } = await ready();
    const first = fakePayload();
    await put(h, cookie, { payload: first, expected_revision: 0 });
    const stale = await put(h, cookie, { payload: fakePayload(), expected_revision: 0 });
    expect(stale.status).toBe(409);
    expect(stale.json?.current).toEqual({ payload: first, revision: 1 });
    const got = await h.call('GET', '/api/vault/settings', { cookie });
    expect(got.json).toEqual({ payload: first, revision: 1 });
  });

  it('dos guardados simultáneos con la misma revisión: uno gana y el otro recibe 409', async () => {
    const { h, cookie } = await ready();
    const [a, b] = await Promise.all([
      put(h, cookie, { payload: fakePayload(), expected_revision: 0 }),
      put(h, cookie, { payload: fakePayload(), expected_revision: 0 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const got = await h.call('GET', '/api/vault/settings', { cookie });
    expect(got.json?.revision).toBe(1);
  });
});

describe('validación del sobre', () => {
  it.each([
    ['sin payload', { expected_revision: 0 }],
    ['payload que no es base64url', { payload: '***', expected_revision: 0 }],
    ['cabecera de recurso (0x02), no de datos', { payload: 'x', expected_revision: 0 }],
    ['revisión negativa', { payload: 'ok', expected_revision: -1 }],
    ['revisión no entera', { payload: 'ok', expected_revision: 1.5 }],
    ['revisión ausente', { payload: 'ok' }],
  ])('%s: 400', async (_name, raw) => {
    const { h, cookie } = await ready();
    const body = { ...raw } as Record<string, unknown>;
    if (body.payload === 'ok') body.payload = fakePayload();
    if (body.payload === 'x') {
      const p = fakePayload();
      // Cambia el tercer byte (finalidad) a 0x02: 'AQEB' → 'AQEC' en base64url.
      body.payload = `AQEC${p.slice(4)}`;
    }
    const r = await put(h, cookie, body);
    expect(r.status).toBe(400);
    const got = await h.call('GET', '/api/vault/settings', { cookie });
    expect(got.json).toEqual({ payload: null, revision: 0 });
  });

  it('mk_version distinta de la del espacio: 400', async () => {
    const { h, cookie } = await ready();
    const r = await put(h, cookie, { payload: fakePayload(120, 2), expected_revision: 0 });
    expect(r.status).toBe(400);
  });

  it('sobre demasiado grande: 413 sin leerlo entero', async () => {
    const { h, cookie } = await ready();
    const r = await put(h, cookie, { payload: 'A'.repeat(80 * 1024), expected_revision: 0 });
    expect(r.status).toBe(413);
  });
});
