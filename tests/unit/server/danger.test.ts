import { describe, expect, it } from 'vitest';
import { rows } from './_d1';
import {
  SETUP_CODE,
  count,
  doLogin,
  doSetup,
  makeHarness,
  newId,
  newSecrets,
  putAssetCall,
  putMemoryCall,
  setupBody,
  type Harness,
} from './_support';

/**
 * H8.3b · borrar todos los recuerdos y eliminar el espacio (data-model.md §7.4, PS-44). Contra el Worker real con D1 y R2
 * simulados: exigen la contraseña actual, no dejan objetos ni filas huérfanas y el código de configuración queda gastado.
 */
async function filled(h: Harness) {
  const { secrets, cookie } = await doSetup(h);
  const keys: string[] = [];
  for (let m = 0; m < 3; m++) {
    const photo = newId();
    const thumb = newId();
    expect((await putAssetCall(h, cookie, photo, 'photo')).status).toBe(201);
    expect((await putAssetCall(h, cookie, thumb, 'thumb', 500, `&parent=${photo}`)).status).toBe(
      201,
    );
    const id = newId();
    expect((await putMemoryCall(h, cookie, id, { asset_ids: [photo, thumb] })).status).toBe(200);
    if (m === 2) await h.call('POST', `/api/memories/${id}/trash`, { cookie });
  }
  expect((await putAssetCall(h, cookie, newId(), 'avatar', 900)).status).toBe(201);
  keys.push(...h.r2.store.keys());
  return { secrets, cookie, keys };
}

const post = (h: Harness, path: string, cookie: string, authPw: string) =>
  h.call('POST', path, { cookie, body: { current_auth_pw: authPw } });

describe('borrar todos los recuerdos', () => {
  it('con la contraseña: recuerdos (también la papelera) y sus fotos fuera; ajustes y avatar se quedan', async () => {
    const h = makeHarness();
    const { secrets, cookie } = await filled(h);
    const r = await post(h, '/api/vault/purge-memories', cookie, secrets.authPw);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ done: true });
    expect(count(h.raw, 'memory')).toBe(0);
    expect(rows<{ kind: string }>(h.raw, 'SELECT kind FROM asset')).toEqual([{ kind: 'avatar' }]);
    expect(h.r2.store.size).toBe(1); // solo el avatar
    expect(count(h.raw, 'vault')).toBe(1);
    // La sesión sigue abierta: se puede seguir usando el espacio vacío.
    expect((await h.call('GET', '/api/memories', { cookie })).status).toBe(200);
  });

  it('contraseña incorrecta: error genérico y no se borra nada', async () => {
    const h = makeHarness();
    const { cookie, keys } = await filled(h);
    const r = await post(h, '/api/vault/purge-memories', cookie, newSecrets().authPw);
    expect(r.status).toBe(401);
    expect(count(h.raw, 'memory')).toBe(3);
    expect([...h.r2.store.keys()].sort()).toEqual([...keys].sort());
  });

  it('sin sesión: 401 y nada cambia', async () => {
    const h = makeHarness();
    const { secrets } = await filled(h);
    const r = await h.call('POST', '/api/vault/purge-memories', {
      body: { current_auth_pw: secrets.authPw },
    });
    expect(r.status).toBe(401);
    expect(count(h.raw, 'memory')).toBe(3);
  });
});

describe('eliminar el espacio', () => {
  it('borra todo (filas y objetos), cierra la sesión y el código de configuración deja de valer', async () => {
    const h = makeHarness();
    const { secrets, cookie } = await filled(h);
    const r = await post(h, '/api/vault/delete', cookie, secrets.authPw);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ done: true });
    expect(r.cookies.join(';')).toMatch(/Max-Age=0/i);
    for (const t of [
      'account',
      'vault',
      'memory',
      'asset',
      'session',
      'login_attempt',
      'security_event',
    ])
      expect(count(h.raw, t), t).toBe(0);
    expect(h.r2.store.size).toBe(0);
    expect(count(h.raw, 'setup_lock')).toBe(1);
    // La huella no es el código.
    expect(JSON.stringify(rows(h.raw, 'SELECT * FROM setup_lock'))).not.toContain(SETUP_CODE);

    expect((await h.call('GET', '/api/auth/params')).json).toMatchObject({ configured: false });
    expect((await h.call('GET', '/api/memories', { cookie })).status).toBe(401);
    expect((await doLogin(h, secrets)).status).toBe(401);
    // Mismo código: rechazado con la respuesta genérica de siempre.
    const again = await h.call('POST', '/api/setup', { body: setupBody(newSecrets()) });
    expect(again.status).toBe(401);
    expect(count(h.raw, 'account')).toBe(0);
  });

  it('con un código NUEVO sí se puede crear (o restaurar) otro espacio', async () => {
    const h = makeHarness();
    const { secrets, cookie } = await filled(h);
    await post(h, '/api/vault/delete', cookie, secrets.authPw);
    const fresh = 'NUEVO-CODIG-ODECO-NFIGU-RACI0';
    h.env.SETUP_CODE = fresh;
    const r = await h.call('POST', '/api/setup', {
      body: setupBody(newSecrets(), { setup_code: fresh }),
    });
    expect(r.status).toBe(200);
  });

  it('contraseña incorrecta: error genérico, no se borra nada y el código sigue sin gastar', async () => {
    const h = makeHarness();
    const { cookie, keys } = await filled(h);
    const r = await post(h, '/api/vault/delete', cookie, newSecrets().authPw);
    expect(r.status).toBe(401);
    expect(count(h.raw, 'account')).toBe(1);
    expect(count(h.raw, 'setup_lock')).toBe(0);
    expect([...h.r2.store.keys()].sort()).toEqual([...keys].sort());
  });

  it('si R2 falla a mitad, no queda ninguna fila `ready` sin objeto y repetir termina el trabajo', async () => {
    const h = makeHarness();
    const { secrets, cookie } = await filled(h);
    const original = h.r2.delete.bind(h.r2);
    h.r2.delete = async () => {
      throw new Error('R2 caído');
    };
    const first = await post(h, '/api/vault/delete', cookie, secrets.authPw);
    expect(first.status).toBe(500);
    expect(count(h.raw, 'account')).toBe(1); // la cuenta sigue: se puede repetir con la misma sesión
    expect(count(h.raw, "asset WHERE state = 'ready'")).toBe(0);
    h.r2.delete = original;
    const second = await post(h, '/api/vault/delete', cookie, secrets.authPw);
    expect(second.json).toEqual({ done: true });
    expect(h.r2.store.size).toBe(0);
    expect(count(h.raw, 'account')).toBe(0);
  });
});
