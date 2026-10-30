import { describe, expect, it } from 'vitest';
import { rows } from './_d1';
import {
  T0,
  doLogin,
  doSetup,
  makeHarness,
  newSecrets,
  setupBody,
  type Harness,
  type Reply,
} from './_support';

/** PS-21: fuerza bruta frenada con retardo progresivo, sin bloqueo permanente. */
const IP = '203.0.113.10';
const bad = (h: Harness, ip: string | undefined = IP): Promise<Reply> =>
  h.call('POST', '/api/auth/login', {
    body: { auth_pw: newSecrets().authPw },
    ...(ip ? { ip } : {}),
  });
const bucket = (h: Harness, name: string) =>
  rows<{ fail_count: number; blocked_until: number }>(
    h.raw,
    'SELECT fail_count, blocked_until FROM login_attempt WHERE bucket = ?',
    name,
  )[0];

describe('retardo progresivo', () => {
  it('1–3 fallos sin espera; luego 5, 15, 30, 60, 120 s; con ≥ 9 el tope (15 min por IP, 5 por cuenta)', async () => {
    const h = makeHarness();
    await doSetup(h);
    const waits: number[] = [];
    for (let k = 1; k <= 10; k++) {
      expect((await bad(h)).status).toBe(401);
      const until = Math.max(
        ...rows<{ blocked_until: number }>(h.raw, 'SELECT blocked_until FROM login_attempt').map(
          (r) => r.blocked_until,
        ),
      );
      const wait = Math.max(0, until - h.clock.now);
      waits.push(wait);
      if (wait > 0) {
        const blocked = await bad(h);
        expect(blocked.status).toBe(429);
        expect(blocked.headers.get('Retry-After')).toBe(String(wait));
        expect(blocked.json).toEqual({ error: 'rate_limited', retry_after: wait });
      }
      h.clock.now += wait; // esperar exactamente lo que se pide
    }
    expect(waits).toEqual([0, 0, 0, 5, 15, 30, 60, 120, 900, 900]);
  });

  it('rechazado por límite NO cuenta como fallo nuevo (no se agrava a sí mismo)', async () => {
    const h = makeHarness();
    await doSetup(h);
    for (let i = 0; i < 4; i++) await bad(h);
    expect(bucket(h, 'acct:login')?.fail_count).toBe(4);
    for (let i = 0; i < 20; i++) expect((await bad(h)).status).toBe(429);
    expect(bucket(h, 'acct:login')?.fail_count).toBe(4);
  });

  it('bloqueado, hasta la contraseña CORRECTA recibe 429 (el límite va antes de verificar); pasada la espera entra y reinicia', async () => {
    const h = makeHarness();
    const { secrets } = await doSetup(h);
    for (let i = 0; i < 4; i++) await bad(h);
    const blocked = await doLogin(h, secrets, { ip: IP });
    expect(blocked.status).toBe(429);
    expect(blocked.json).toEqual({ error: 'rate_limited', retry_after: 5 });
    expect(blocked.cookies).toHaveLength(0);
    h.clock.now += 5;
    const ok = await doLogin(h, secrets, { ip: IP });
    expect(ok.status).toBe(200);
    expect(bucket(h, 'acct:login')).toBeUndefined();
    expect(rows(h.raw, "SELECT 1 FROM login_attempt WHERE bucket LIKE 'ip:%'")).toHaveLength(0);
    expect((await bad(h)).status).toBe(401); // vuelve a empezar desde cero
    expect(bucket(h, 'acct:login')?.fail_count).toBe(1);
  });

  it('nunca hay bloqueo permanente: tras 1 h sin fallos el contador vuelve a cero', async () => {
    const h = makeHarness();
    await doSetup(h);
    for (let k = 0; k < 9; k++) {
      await bad(h);
      h.clock.now += 1000; // sobrepasa cualquier espera, sin llegar a 1 h
    }
    expect(bucket(h, 'acct:login')?.fail_count).toBe(9);
    h.clock.now += 3601;
    expect((await bad(h)).status).toBe(401);
    expect(bucket(h, 'acct:login')?.fail_count).toBe(1);
    expect(bucket(h, 'acct:login')?.blocked_until).toBe(h.clock.now);
    expect((await bad(h)).status).toBe(401); // sin espera
  });

  it('el máximo que puede bloquear a quien cambia de IP es 5 min (tope de la cuenta)', async () => {
    const h = makeHarness();
    await doSetup(h);
    let last = 0;
    for (let k = 0; k < 14; k++) {
      const r = await bad(h, `198.51.100.${k + 1}`); // una IP distinta cada vez
      if (r.status === 429) {
        last = Number(r.headers.get('Retry-After'));
        h.clock.now += last;
        await bad(h, `198.51.100.${k + 1}`);
      }
    }
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThanOrEqual(300);
  });

  it('IPv6 del mismo /64 comparte cubo; otra IP distinta no', async () => {
    const h = makeHarness();
    await doSetup(h);
    for (let i = 0; i < 4; i++) await bad(h, `2001:db8:1:2:${i}::1`);
    expect(rows(h.raw, "SELECT 1 FROM login_attempt WHERE bucket LIKE 'ip:%'")).toHaveLength(1);
  });
});

describe('cubos independientes', () => {
  it('la recuperación y el acceso tienen cubos distintos (con otra IP, el acceso no se ve afectado)', async () => {
    const h = makeHarness();
    const { secrets } = await doSetup(h);
    for (let i = 0; i < 6; i++) {
      if (i > 0) h.clock.now += 1000; // deja pasar la espera anterior
      await h.call('POST', '/api/auth/recover', {
        body: { auth_rec: newSecrets().authRec },
        ip: '198.51.100.77',
      });
    }
    expect(bucket(h, 'acct:recover')?.fail_count).toBe(6);
    expect(bucket(h, 'acct:login')).toBeUndefined();
    expect(
      (
        await h.call('POST', '/api/auth/recover', {
          body: { auth_rec: secrets.authRec },
          ip: '198.51.100.78',
        })
      ).status,
    ).toBe(429); // cubo de cuenta (6 fallos), otra IP
    expect((await doLogin(h, secrets, { ip: '198.51.100.79' })).status).toBe(200);
  });

  it('cambio de contraseña, regenerar clave y KDF con la actual incorrecta cuentan en el cubo de acceso', async () => {
    const h = makeHarness();
    const { cookie } = await doSetup(h);
    const body = {
      kdf: setupBody(newSecrets()).kdf,
      auth_pw: newSecrets().authPw,
      wrapped_mk_pw: setupBody(newSecrets()).wrapped_mk_pw,
      expected_key_revision: 1,
      current_auth_pw: newSecrets().authPw,
    };
    for (const path of ['/api/vault/password', '/api/vault/kdf']) {
      await h.call('PUT', path, { cookie, body, ip: IP });
    }
    expect(bucket(h, 'acct:login')?.fail_count).toBe(2);
  });

  it('los intentos de primer acceso con código erróneo también se frenan', async () => {
    const h = makeHarness();
    for (let i = 0; i < 4; i++)
      await h.call('POST', '/api/setup', {
        body: setupBody(newSecrets(), { setup_code: 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX' }),
        ip: IP,
      });
    const blocked = await h.call('POST', '/api/setup', { body: setupBody(newSecrets()), ip: IP });
    expect(blocked.status).toBe(429); // ni siquiera el código correcto pasa mientras dura el bloqueo
  });

  it('cubo global: por encima de 60 fallos por hora, cada intento exige 30 s desde el anterior', async () => {
    const h = makeHarness();
    const { secrets } = await doSetup(h);
    h.raw
      .prepare(
        "INSERT INTO login_attempt (bucket, fail_count, window_start, blocked_until, updated_at) VALUES ('global:auth', 60, ?, 0, ?)",
      )
      .run(T0, T0);
    expect((await bad(h, '198.51.100.1')).status).toBe(401); // el fallo 61 activa el espaciado
    expect(bucket(h, 'global:auth')?.fail_count).toBe(61);
    const next = await bad(h, '198.51.100.2');
    expect(next.status).toBe(429);
    expect(next.headers.get('Retry-After')).toBe('30');
    h.clock.now += 30;
    expect((await doLogin(h, secrets, { ip: '198.51.100.3' })).status).toBe(200);
    expect(bucket(h, 'global:auth')?.fail_count).toBe(61); // el acceso correcto no reinicia el global
    h.clock.now += 3600;
    expect((await bad(h, '198.51.100.4')).status).toBe(401);
    expect(bucket(h, 'global:auth')?.fail_count).toBe(1); // ventana nueva
  });
});

describe('atomicidad y registro', () => {
  it('30 intentos fallidos en paralelo cuentan 30 (el contador sube con una sola sentencia atómica)', async () => {
    const h = makeHarness();
    await doSetup(h);
    const replies = await Promise.all(Array.from({ length: 30 }, () => bad(h)));
    expect(replies.every((r) => r.status === 401)).toBe(true);
    expect(bucket(h, 'acct:login')?.fail_count).toBe(30);
    expect(
      rows<{ bucket: string; fail_count: number }>(
        h.raw,
        "SELECT bucket, fail_count FROM login_attempt WHERE bucket LIKE 'ip:%'",
      )[0]?.fail_count,
    ).toBe(30);
    expect(bucket(h, 'global:auth')?.fail_count).toBe(30);
  });

  it('un fallo escribe como mucho tres filas de contador (ip, cuenta, global): presupuesto de escrituras de D1', async () => {
    const h = makeHarness();
    await doSetup(h);
    await bad(h);
    expect(rows(h.raw, 'SELECT 1 FROM login_attempt')).toHaveLength(3);
  });

  it('«ráfaga de fallos» se anota una sola vez por ventana, al llegar a 5', async () => {
    const h = makeHarness();
    await doSetup(h);
    for (let k = 0; k < 9; k++) {
      await bad(h);
      h.clock.now += 1000;
    }
    expect(
      rows(h.raw, "SELECT 1 FROM security_event WHERE type = 'login_fail_burst'"),
    ).toHaveLength(1);
  });

  it('el cubo de IP no guarda la IP: solo una huella de 16 hex', async () => {
    const h = makeHarness();
    await doSetup(h);
    await bad(h, '203.0.113.99');
    const all = JSON.stringify(rows(h.raw, 'SELECT * FROM login_attempt'));
    expect(all).not.toContain('203.0.113.99');
    expect(all).toMatch(/"ip:[0-9a-f]{16}"/);
  });
});
