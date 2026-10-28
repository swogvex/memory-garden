import { describe, expect, it } from 'vitest';
import { toB64Url, randomBytes } from '@/server/bytes';
import { rows } from './_d1';
import {
  SETUP_CODE,
  T0,
  cookieOf,
  count,
  doLogin,
  doSetup,
  fakeWrapped,
  kdfText,
  makeHarness,
  newSecrets,
  setupBody,
  type Harness,
  type Reply,
} from './_support';

/** Sonda: una ruta protegida con cuerpo vacío. 400 = la sesión es válida y llegó al manejador; 401 = no. */
const probe = async (h: Harness, cookie: string): Promise<number> =>
  (await h.call('PUT', '/api/vault/kdf', { cookie, body: {} })).status;
const probeRecovery = async (h: Harness, cookie: string): Promise<number> =>
  (await h.call('PUT', '/api/vault/recovery-reset', { cookie, body: {} })).status;
const GENERIC = { error: 'invalid_credentials' };

function dump(h: Harness): string {
  const parts: string[] = [];
  for (const t of ['account', 'vault', 'session', 'login_attempt', 'security_event'])
    parts.push(JSON.stringify(rows(h.raw, `SELECT * FROM ${t}`)));
  return parts.join('\n');
}

describe('primer acceso (PS-07, PS-17)', () => {
  it('antes del primer acceso `params` dice configured:false', async () => {
    const h = makeHarness();
    const r = await h.call('GET', '/api/auth/params');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ configured: false, kdf: null, rec_salt: null });
  });

  it('sin código, con código incorrecto o sin SETUP_CODE configurado: 401 genérico y no se crea nada', async () => {
    const s = newSecrets();
    for (const env of [{}, { SETUP_CODE: undefined }]) {
      const h = makeHarness(env);
      const bodies = [
        setupBody(s, { setup_code: undefined }),
        setupBody(s, { setup_code: 'AAAAA-AAAAA-AAAAA-AAAAA-AAAAA' }),
        setupBody(s, { setup_code: 5 }),
        setupBody(s, { setup_code: '' }),
      ];
      if (env.SETUP_CODE === undefined && 'SETUP_CODE' in env) bodies.push(setupBody(s)); // el código correcto tampoco sirve si el servidor no tiene ninguno
      for (const body of bodies) {
        h.raw.exec('DELETE FROM login_attempt'); // el límite de intentos se prueba aparte
        const r = await h.call('POST', '/api/setup', { body });
        expect(r.status).toBe(401);
        expect(r.json).toEqual(GENERIC);
      }
      for (const t of ['account', 'vault', 'session']) expect(count(h.raw, t)).toBe(0);
    }
  });

  it('con el código correcto crea cuenta, espacio, sesión y evento; el formato del código es tolerante', async () => {
    const h = makeHarness();
    const lax = SETUP_CODE.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
    const s = newSecrets();
    const r = await h.call('POST', '/api/setup', { body: setupBody(s, { setup_code: lax }) });
    expect(r.status).toBe(200);
    expect(r.json?.key_revision).toBe(1);
    expect(r.cookies).toHaveLength(1);
    expect(count(h.raw, 'account')).toBe(1);
    expect(count(h.raw, 'vault')).toBe(1);
    expect(count(h.raw, 'session')).toBe(1);
    expect(
      rows<{ type: string }>(h.raw, 'SELECT type FROM security_event').map((e) => e.type),
    ).toEqual(['setup']);
    const params = await h.call('GET', '/api/auth/params');
    expect(params.json?.configured).toBe(true);
    expect(String(params.json?.kdf)).toContain('pbkdf2-sha256');
  });

  it('no se puede repetir: un segundo primer acceso con el código correcto da 401 y sigue habiendo una sola cuenta', async () => {
    const h = makeHarness();
    await doSetup(h);
    const again = await h.call('POST', '/api/setup', { body: setupBody(newSecrets()) });
    expect(again.status).toBe(401);
    expect(again.json).toEqual(GENERIC);
    expect(count(h.raw, 'account')).toBe(1);
  });

  it('carrera: dos primeros accesos simultáneos dejan una sola cuenta (restricción UNIQUE)', async () => {
    const h = makeHarness();
    const [a, b] = await Promise.all([
      h.call('POST', '/api/setup', { body: setupBody(newSecrets()) }),
      h.call('POST', '/api/setup', { body: setupBody(newSecrets()) }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    expect(count(h.raw, 'account')).toBe(1);
    expect(count(h.raw, 'vault')).toBe(1);
  });

  it('con el código bueno pero la carga inválida: 400 y nada creado; luego una carga válida funciona', async () => {
    const h = makeHarness();
    const s = newSecrets();
    const bad: Record<string, unknown>[] = [
      { kdf: kdfText(100_000) },
      { kdf: kdfText(20_000_000) },
      { kdf: kdfText().replace(',"alg"', ', "alg"') },
      { vault_id: 'corto' },
      { auth_pw: 'corto' },
      { auth_rec: 5 },
      { rec_salt: toB64Url(randomBytes(15)) },
      { wrapped_mk_pw: fakeWrapped('rec') },
      { wrapped_mk_rec: 'x'.repeat(86) },
      { mk_version: 0 },
      { mk_version: 256 },
      { mk_version: '1' },
    ];
    for (const over of bad) {
      const r = await h.call('POST', '/api/setup', {
        body: setupBody(s, over),
        ip: '198.51.100.9',
      });
      expect(r.status).toBe(400);
      expect(count(h.raw, 'account')).toBe(0);
    }
    expect((await h.call('POST', '/api/setup', { body: setupBody(s) })).status).toBe(200);
  });

  it('el servidor guarda solo hashes: ni auth_pw, ni auth_rec ni el token de sesión aparecen en la base de datos', async () => {
    const h = makeHarness();
    const { secrets, cookie } = await doSetup(h);
    await doLogin(h, secrets);
    const all = dump(h);
    expect(all).not.toContain(secrets.authPw);
    expect(all).not.toContain(secrets.authRec);
    expect(all).not.toContain(cookie.split('=')[1] ?? 'x');
    const acc = rows<{ auth_hash: string; recovery_auth_hash: string }>(
      h.raw,
      'SELECT auth_hash, recovery_auth_hash FROM account',
    )[0];
    expect(acc?.auth_hash).toHaveLength(43);
    expect(acc?.auth_hash).not.toBe(acc?.recovery_auth_hash);
  });
});

describe('acceso, cookie y sesión (PS-23, PS-24)', () => {
  it('login correcto: devuelve lo necesario para desbloquear, con cookie nueva y rotación de la anterior', async () => {
    const h = makeHarness();
    const { secrets, cookie: first, body } = await doSetup(h);
    const r = await doLogin(h, secrets, { cookie: first });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      vault_id: body.vault_id,
      kdf: body.kdf,
      mk_version: 1,
      key_revision: 1,
      wrapped_mk_pw: body.wrapped_mk_pw,
    });
    const second = cookieOf(r);
    expect(second).not.toBe(first);
    expect(await probe(h, first)).toBe(401); // la anterior dejó de valer
    expect(await probe(h, second)).toBe(400); // la nueva llega al manejador
    expect(count(h.raw, 'session')).toBe(1);
  });

  it('atributos de la cookie en local (localhost + MG_ENV=local): sin prefijo ni Secure, con HttpOnly y SameSite=Strict', async () => {
    const h = makeHarness();
    const { reply } = await doSetup(h);
    expect(reply.cookies[0]).toMatch(
      /^mg_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200$/,
    );
  });

  it('atributos en producción (sin MG_ENV): __Host-, Secure, HttpOnly, SameSite=Strict, Path=/ y sin Domain (PS-23)', async () => {
    const h = makeHarness({ MG_ENV: undefined });
    const body = setupBody(newSecrets());
    const r = await h.call('POST', '/api/setup', {
      body,
      url: 'https://memorygarden.date/api/setup',
      headers: { Origin: 'https://memorygarden.date' },
    });
    expect(r.status).toBe(200);
    const c = r.cookies[0] ?? '';
    expect(c).toMatch(
      /^__Host-mg_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200$/,
    );
    expect(c).not.toMatch(/Domain/i);
  });

  it('con MG_ENV=local pero host que no es localhost (túnel HTTPS del iPhone): forma estricta', async () => {
    const h = makeHarness({ EXTRA_ORIGINS: 'https://abc.devtunnels.ms' });
    const r = await h.call('POST', '/api/setup', {
      body: setupBody(newSecrets()),
      url: 'https://abc.devtunnels.ms/api/setup',
      headers: { Origin: 'https://abc.devtunnels.ms' },
    });
    expect(r.cookies[0]).toMatch(/^__Host-mg_session=.*; Secure; HttpOnly; SameSite=Strict/);
  });

  it('en modo estricto una cookie con el nombre relajado se ignora', async () => {
    const h = makeHarness({ MG_ENV: undefined });
    const url = 'https://memorygarden.date';
    const o = { url: `${url}/api/setup`, headers: { Origin: url } };
    const setup = await h.call('POST', '/api/setup', { body: setupBody(newSecrets()), ...o });
    const token = cookieOf(setup).split('=')[1] ?? '';
    const r = await h.call('PUT', '/api/vault/kdf', {
      body: {},
      cookie: `mg_session=${token}`,
      url: `${url}/api/vault/kdf`,
      headers: { Origin: url },
    });
    expect(r.status).toBe(401);
    const good = await h.call('PUT', '/api/vault/kdf', {
      body: {},
      cookie: `__Host-mg_session=${token}`,
      url: `${url}/api/vault/kdf`,
      headers: { Origin: url },
    });
    expect(good.status).toBe(400);
  });

  it('logout: borra la fila, expira la cookie, envía Clear-Site-Data y la cookie vieja da 401', async () => {
    const h = makeHarness();
    const { cookie } = await doSetup(h);
    const r = await h.call('POST', '/api/auth/logout', { cookie });
    expect(r.status).toBe(204);
    expect(r.cookies[0]).toMatch(/Max-Age=0$/);
    expect(r.headers.get('Clear-Site-Data')).toBe('"cache", "cookies"');
    expect(count(h.raw, 'session')).toBe(0);
    expect(await probe(h, cookie)).toBe(401);
    expect((await h.call('POST', '/api/auth/logout', { cookie })).status).toBe(401);
  });

  it('el token solo existe como hash en D1', async () => {
    const h = makeHarness();
    const { cookie } = await doSetup(h);
    const token = cookie.split('=')[1] ?? '';
    const row = rows<{ token_hash: string }>(h.raw, 'SELECT token_hash FROM session')[0];
    expect(row?.token_hash).toHaveLength(43);
    expect(row?.token_hash).not.toBe(token);
  });

  it('caducidad absoluta de 12 h aunque haya actividad constante (PS-24)', async () => {
    const h = makeHarness();
    const { cookie } = await doSetup(h);
    for (let t = 20; t <= 700; t += 20) {
      h.clock.now = T0 + t * 60;
      expect(await probe(h, cookie)).toBe(400);
    }
    h.clock.now = T0 + 12 * 3600 + 1;
    expect(await probe(h, cookie)).toBe(401);
    expect(count(h.raw, 'session')).toBe(0); // se borra al detectar la caducidad
  });

  it('caducidad por inactividad de 30 min', async () => {
    const h = makeHarness();
    const { cookie } = await doSetup(h);
    h.clock.now = T0 + 30 * 60;
    expect(await probe(h, cookie)).toBe(400); // justo en el límite sigue viva
    h.clock.now = T0 + 30 * 60 + 31 * 60;
    expect(await probe(h, cookie)).toBe(401);
  });

  it('`last_seen_at` solo se reescribe si lleva más de 5 minutos sin tocarse', async () => {
    const h = makeHarness();
    const { cookie } = await doSetup(h);
    h.clock.now = T0 + 120;
    await probe(h, cookie);
    expect(
      rows<{ last_seen_at: number }>(h.raw, 'SELECT last_seen_at FROM session')[0]?.last_seen_at,
    ).toBe(T0);
    h.clock.now = T0 + 400;
    await probe(h, cookie);
    expect(
      rows<{ last_seen_at: number }>(h.raw, 'SELECT last_seen_at FROM session')[0]?.last_seen_at,
    ).toBe(T0 + 400);
  });

  it('un acceso correcto purga lo caducado (sesiones, contadores viejos y eventos de más de 180 días)', async () => {
    const h = makeHarness();
    const { secrets } = await doSetup(h);
    h.raw
      .prepare(
        "INSERT INTO session (token_hash, account_id, scope, created_at, last_seen_at, expires_at) SELECT ?, id, 'full', 1, 1, 2 FROM account",
      )
      .run('z'.repeat(43));
    h.raw
      .prepare(
        "INSERT INTO login_attempt (bucket, fail_count, window_start, blocked_until, updated_at) VALUES ('ip:viejo', 3, 1, 0, 1)",
      )
      .run();
    h.raw.prepare("INSERT INTO security_event (type, created_at) VALUES ('login_ok', 1)").run();
    await doLogin(h, secrets);
    expect(rows(h.raw, 'SELECT 1 FROM session WHERE token_hash = ?', 'z'.repeat(43))).toHaveLength(
      0,
    );
    expect(rows(h.raw, "SELECT 1 FROM login_attempt WHERE bucket = 'ip:viejo'")).toHaveLength(0);
    expect(rows(h.raw, 'SELECT 1 FROM security_event WHERE created_at = 1')).toHaveLength(0);
  });

  it('login con credencial incorrecta: 401 genérico, sin sesión nueva', async () => {
    const h = makeHarness();
    await doSetup(h);
    const before = count(h.raw, 'session');
    const r = await doLogin(h, newSecrets());
    expect(r.status).toBe(401);
    expect(r.json).toEqual(GENERIC);
    expect(r.cookies).toHaveLength(0);
    expect(count(h.raw, 'session')).toBe(before);
  });
});

async function twoSessions(h: Harness) {
  const { secrets, cookie: a, body } = await doSetup(h);
  const b = cookieOf(await doLogin(h, secrets, { ip: '203.0.113.50' }));
  return { secrets, a, b, body };
}
const keyChange = (over: Record<string, unknown> = {}) => ({
  kdf: kdfText(1_500_000),
  auth_pw: newSecrets().authPw,
  wrapped_mk_pw: fakeWrapped('pw'),
  expected_key_revision: 1,
  ...over,
});

describe('cambio de contraseña (PS-18)', () => {
  it('reemplaza credenciales, sube key_revision, revoca TODAS las demás sesiones y rota la propia', async () => {
    const h = makeHarness();
    const { secrets, a, b } = await twoSessions(h);
    const next = newSecrets();
    const body = keyChange({ current_auth_pw: secrets.authPw, auth_pw: next.authPw });
    const r = await h.call('PUT', '/api/vault/password', { cookie: a, body });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ key_revision: 2 });
    const fresh = cookieOf(r);
    expect(await probe(h, a)).toBe(401);
    expect(await probe(h, b)).toBe(401);
    expect(await probe(h, fresh)).toBe(400);
    expect(count(h.raw, 'session')).toBe(1);
    expect((await doLogin(h, secrets, { ip: '203.0.113.60' })).status).toBe(401); // la contraseña vieja ya no entra
    const ok = await doLogin(h, next, { ip: '203.0.113.61' });
    expect(ok.status).toBe(200);
    expect(ok.json?.wrapped_mk_pw).toBe(body.wrapped_mk_pw);
    expect(ok.json?.key_revision).toBe(2);
    expect(
      rows<{ type: string }>(
        h.raw,
        "SELECT type FROM security_event WHERE type = 'password_changed'",
      ),
    ).toHaveLength(1);
  });

  it('con la contraseña actual incorrecta: 401 genérico y NADA cambia', async () => {
    const h = makeHarness();
    const { a, b } = await twoSessions(h);
    const before = dump(h).replace(/"(login_attempt)"[^\n]*/g, '');
    const r = await h.call('PUT', '/api/vault/password', {
      cookie: a,
      body: keyChange({ current_auth_pw: newSecrets().authPw }),
    });
    expect(r.status).toBe(401);
    expect(r.json).toEqual(GENERIC);
    expect(await probe(h, a)).toBe(400);
    expect(await probe(h, b)).toBe(400);
    expect(
      rows<{ key_revision: number }>(h.raw, 'SELECT key_revision FROM vault')[0]?.key_revision,
    ).toBe(1);
    expect(before).toBeTruthy();
  });

  it('revisión obsoleta: 409 y la transacción NO deja nada a medias (hash, envoltura y sesiones intactos)', async () => {
    const h = makeHarness();
    const { secrets, a, b } = await twoSessions(h);
    const snap = () =>
      JSON.stringify([
        rows(h.raw, 'SELECT * FROM account'),
        rows(h.raw, 'SELECT * FROM vault'),
        rows(h.raw, 'SELECT token_hash FROM session ORDER BY token_hash'),
        rows(h.raw, "SELECT type FROM security_event WHERE type <> 'login_ok'"),
      ]);
    const before = snap();
    const r = await h.call('PUT', '/api/vault/password', {
      cookie: a,
      body: keyChange({ current_auth_pw: secrets.authPw, expected_key_revision: 7 }),
    });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'conflict' });
    expect(snap()).toBe(before);
    expect(await probe(h, a)).toBe(400);
    expect(await probe(h, b)).toBe(400);
  });

  it('dos cambios con la misma revisión: gana uno, el otro recibe 409', async () => {
    const h = makeHarness();
    const { secrets, a, b } = await twoSessions(h);
    const [x, y] = await Promise.all([
      h.call('PUT', '/api/vault/password', {
        cookie: a,
        body: keyChange({ current_auth_pw: secrets.authPw }),
      }),
      h.call('PUT', '/api/vault/password', {
        cookie: b,
        body: keyChange({ current_auth_pw: secrets.authPw }),
      }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(
      rows<{ key_revision: number }>(h.raw, 'SELECT key_revision FROM vault')[0]?.key_revision,
    ).toBe(2);
  });

  it('cuerpo inválido: 400', async () => {
    const h = makeHarness();
    const { secrets, a } = await twoSessions(h);
    for (const over of [
      { kdf: kdfText(1000) },
      { auth_pw: 'x' },
      { wrapped_mk_pw: fakeWrapped('rec') },
      { expected_key_revision: 0 },
      { expected_key_revision: '1' },
    ]) {
      const r = await h.call('PUT', '/api/vault/password', {
        cookie: a,
        body: keyChange({ current_auth_pw: secrets.authPw, ...over }),
      });
      expect(r.status).toBe(400);
    }
  });
});

describe('clave de recuperación y KDF (PS-19, PS-20)', () => {
  const recBody = (over: Record<string, unknown> = {}) => ({
    rec_salt: toB64Url(randomBytes(16)),
    auth_rec: newSecrets().authRec,
    wrapped_mk_rec: fakeWrapped('rec'),
    expected_key_revision: 1,
    ...over,
  });

  it('regenerar: la antigua deja de valer, la nueva funciona y las sesiones de acceso siguen', async () => {
    const h = makeHarness();
    const { secrets, a } = await twoSessions(h);
    const fresh = recBody();
    const r = await h.call('PUT', '/api/vault/recovery-key', {
      cookie: a,
      body: { ...fresh, current_auth_pw: secrets.authPw },
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ key_revision: 2 });
    expect(await probe(h, a)).toBe(400);
    expect(
      (
        await h.call('POST', '/api/auth/recover', {
          body: { auth_rec: secrets.authRec },
          ip: '198.51.100.1',
        })
      ).status,
    ).toBe(401);
    const ok = await h.call('POST', '/api/auth/recover', {
      body: { auth_rec: fresh.auth_rec },
      ip: '198.51.100.2',
    });
    expect(ok.status).toBe(200);
    expect(ok.json?.wrapped_mk_rec).toBe(fresh.wrapped_mk_rec);
    expect(ok.json?.rec_salt).toBe(fresh.rec_salt);
  });

  it('regenerar: contraseña actual incorrecta → 401; revisión obsoleta → 409 sin cambios', async () => {
    const h = makeHarness();
    const { secrets, a } = await twoSessions(h);
    expect(
      (
        await h.call('PUT', '/api/vault/recovery-key', {
          cookie: a,
          body: { ...recBody(), current_auth_pw: newSecrets().authPw },
        })
      ).status,
    ).toBe(401);
    const before = JSON.stringify(rows(h.raw, 'SELECT * FROM vault'));
    expect(
      (
        await h.call('PUT', '/api/vault/recovery-key', {
          cookie: a,
          body: { ...recBody({ expected_key_revision: 3 }), current_auth_pw: secrets.authPw },
        })
      ).status,
    ).toBe(409);
    expect(JSON.stringify(rows(h.raw, 'SELECT * FROM vault'))).toBe(before);
  });

  it('actualizar KDF: sube iteraciones con la misma contraseña, mantiene las sesiones y no se puede rebajar', async () => {
    const h = makeHarness();
    const { secrets, a, b } = await twoSessions(h);
    const next = newSecrets();
    const up = keyChange({
      current_auth_pw: secrets.authPw,
      kdf: kdfText(2_000_000),
      auth_pw: next.authPw,
    });
    const r = await h.call('PUT', '/api/vault/kdf', { cookie: a, body: up });
    expect(r.status).toBe(200);
    expect(await probe(h, b)).toBe(400); // otras sesiones siguen
    expect((await doLogin(h, next, { ip: '203.0.113.70' })).json?.kdf).toBe(up.kdf);
    const down = keyChange({
      current_auth_pw: next.authPw,
      kdf: kdfText(1_000_000),
      expected_key_revision: 2,
    });
    expect((await h.call('PUT', '/api/vault/kdf', { cookie: a, body: down })).status).toBe(400);
    const stale = keyChange({
      current_auth_pw: next.authPw,
      kdf: kdfText(2_500_000),
      expected_key_revision: 1,
    });
    expect((await h.call('PUT', '/api/vault/kdf', { cookie: a, body: stale })).status).toBe(409);
    expect(
      rows<{ type: string }>(h.raw, "SELECT type FROM security_event WHERE type = 'kdf_upgraded'"),
    ).toHaveLength(1);
  });
});

describe('recuperación (PS-17, PS-05)', () => {
  const resetBody = (over: Record<string, unknown> = {}) => ({
    kdf: kdfText(),
    auth_pw: newSecrets().authPw,
    wrapped_mk_pw: fakeWrapped('pw'),
    rec_salt: toB64Url(randomBytes(16)),
    auth_rec: newSecrets().authRec,
    wrapped_mk_rec: fakeWrapped('rec'),
    expected_key_revision: 1,
    ...over,
  });
  const recover = (h: Harness, authRec: string, ip = '198.51.100.20'): Promise<Reply> =>
    h.call('POST', '/api/auth/recover', { body: { auth_rec: authRec }, ip });

  it('clave incorrecta: 401 genérico; correcta: sesión de ámbito recovery con wrapped_mk_rec', async () => {
    const h = makeHarness();
    const { secrets, body } = await doSetup(h);
    const bad = await recover(h, newSecrets().authRec);
    expect(bad.status).toBe(401);
    expect(bad.json).toEqual(GENERIC);
    const ok = await recover(h, secrets.authRec, '198.51.100.21');
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({
      vault_id: body.vault_id,
      mk_version: 1,
      key_revision: 1,
      rec_salt: body.rec_salt,
      wrapped_mk_rec: body.wrapped_mk_rec,
    });
    expect(ok.cookies[0]).toMatch(/Max-Age=900$/);
    expect(
      rows<{ scope: string }>(h.raw, "SELECT scope FROM session WHERE scope = 'recovery'"),
    ).toHaveLength(1);
  });

  it('la sesión de recuperación no sirve para nada salvo recovery-reset (PS-05) y caduca a los 15 min (5 de inactividad)', async () => {
    const h = makeHarness();
    const { secrets } = await doSetup(h);
    const cookie = cookieOf(await recover(h, secrets.authRec));
    expect(await probe(h, cookie)).toBe(401); // ruta de ámbito full
    expect((await h.call('PUT', '/api/vault/password', { cookie, body: {} })).status).toBe(401);
    expect(await probeRecovery(h, cookie)).toBe(400);
    h.clock.now = T0 + 6 * 60;
    expect(await probeRecovery(h, cookie)).toBe(401); // 6 min sin actividad
    const again = cookieOf(await recover(h, secrets.authRec, '198.51.100.30'));
    for (let t = 4; t <= 14; t += 4) {
      h.clock.now += 4 * 60;
      expect(await probeRecovery(h, again)).toBe(400);
    }
    h.clock.now += 4 * 60; // pasan 16+ min desde su creación
    expect(await probeRecovery(h, again)).toBe(401);
  });

  it('recovery-reset: sustituye ambas credenciales, revoca todas las sesiones, emite una completa y la antigua clave deja de valer', async () => {
    const h = makeHarness();
    const { secrets, cookie: full } = await doSetup(h);
    const rec = cookieOf(await recover(h, secrets.authRec));
    const body = resetBody();
    const r = await h.call('PUT', '/api/vault/recovery-reset', { cookie: rec, body });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ key_revision: 2 });
    const fresh = cookieOf(r);
    expect(await probe(h, full)).toBe(401);
    expect(await probeRecovery(h, rec)).toBe(401);
    expect(await probe(h, fresh)).toBe(400);
    expect(count(h.raw, 'session')).toBe(1);
    expect((await doLogin(h, secrets, { ip: '203.0.113.80' })).status).toBe(401);
    const ok = await doLogin(
      h,
      { authPw: body.auth_pw, authRec: body.auth_rec },
      { ip: '203.0.113.81' },
    );
    expect(ok.status).toBe(200);
    expect(ok.json?.wrapped_mk_pw).toBe(body.wrapped_mk_pw);
    expect((await recover(h, secrets.authRec, '198.51.100.40')).status).toBe(401);
    expect((await recover(h, body.auth_rec, '198.51.100.41')).status).toBe(200);
    expect(
      rows<{ type: string }>(h.raw, "SELECT type FROM security_event WHERE type = 'recovery_used'"),
    ).toHaveLength(1);
  });

  it('recovery-reset con revisión obsoleta: 409 y todo intacto', async () => {
    const h = makeHarness();
    const { secrets } = await doSetup(h);
    const rec = cookieOf(await recover(h, secrets.authRec));
    const before = JSON.stringify([
      rows(h.raw, 'SELECT * FROM account'),
      rows(h.raw, 'SELECT * FROM vault'),
    ]);
    expect(
      (
        await h.call('PUT', '/api/vault/recovery-reset', {
          cookie: rec,
          body: resetBody({ expected_key_revision: 4 }),
        })
      ).status,
    ).toBe(409);
    expect(
      JSON.stringify([rows(h.raw, 'SELECT * FROM account'), rows(h.raw, 'SELECT * FROM vault')]),
    ).toBe(before);
    expect(await probeRecovery(h, rec)).toBe(400); // la sesión sigue
  });

  it('recovery-reset con una sesión completa o con cuerpo inválido no cambia nada', async () => {
    const h = makeHarness();
    const { secrets, cookie: full } = await doSetup(h);
    expect(
      (await h.call('PUT', '/api/vault/recovery-reset', { cookie: full, body: resetBody() }))
        .status,
    ).toBe(401);
    const rec = cookieOf(await recover(h, secrets.authRec));
    for (const over of [
      { kdf: kdfText(5) },
      { wrapped_mk_rec: fakeWrapped('pw') },
      { rec_salt: 'x' },
      { auth_rec: 3 },
    ]) {
      expect(
        (await h.call('PUT', '/api/vault/recovery-reset', { cookie: rec, body: resetBody(over) }))
          .status,
      ).toBe(400);
    }
    expect(
      rows<{ key_revision: number }>(h.raw, 'SELECT key_revision FROM vault')[0]?.key_revision,
    ).toBe(1);
  });

  it('recuperar sin espacio creado: 401 genérico', async () => {
    const h = makeHarness();
    const r = await recover(h, newSecrets().authRec);
    expect(r.status).toBe(401);
    expect(r.json).toEqual(GENERIC);
  });

  it('una sola sesión de recuperación a la vez', async () => {
    const h = makeHarness();
    const { secrets } = await doSetup(h);
    await recover(h, secrets.authRec, '198.51.100.50');
    await recover(h, secrets.authRec, '198.51.100.51');
    expect(rows(h.raw, "SELECT 1 FROM session WHERE scope = 'recovery'")).toHaveLength(1);
  });
});
