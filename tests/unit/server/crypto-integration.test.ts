import { describe, expect, it } from 'vitest';
import { createVault, disposeMaterial, preparePassword, unwrapWithPassword } from '@/lib/crypto';
import { SETUP_CODE, makeHarness, type Harness } from './_support';

/**
 * Cliente real (`lib/crypto`) contra el servidor real (`src/server`) con D1 simulada.
 * Comprueba dos cosas que las pruebas con cargas sintéticas no pueden: que el formato que produce el cliente
 * lo acepta la validación del servidor, y que el servidor nunca recibe la contraseña ni la clave de recuperación.
 * Usa la política de producción del KDF (≈ 0,4 s por derivación en un PC): por eso hay pocas pruebas y tiempo ampliado.
 */
const PASSWORD = 'correcto caballo bateria grapa 2026!';
const TIMEOUT = 60_000;

interface Wire {
  vaultId: string;
  kdf: string;
  mkVersion: number;
  wrappedMkPw: string;
  recSalt: string;
  wrappedMkRec: string;
}
interface Created {
  wire: Wire;
  authPw: string;
  authRec: string;
  recoveryKey: string;
}

/** Cuerpo exacto que el cliente envía en el primer acceso, a partir de lo que devuelve `createVault`. */
function setupPayload(c: Created): Record<string, unknown> {
  return {
    setup_code: SETUP_CODE,
    vault_id: c.wire.vaultId,
    kdf: c.wire.kdf,
    auth_pw: c.authPw,
    rec_salt: c.wire.recSalt,
    auth_rec: c.authRec,
    wrapped_mk_pw: c.wire.wrappedMkPw,
    wrapped_mk_rec: c.wire.wrappedMkRec,
    mk_version: c.wire.mkVersion,
  };
}

/** Todo lo que el servidor llega a ver: se comprueba contra los secretos que no deben cruzar la red. */
function wireLog(h: Harness): string[] {
  const seen: string[] = [];
  const real = h.env.DB;
  h.env.DB = {
    prepare(sql: string) {
      const st = real.prepare(sql);
      return new Proxy(st, {
        get(target, key) {
          if (key === 'bind') {
            return (...args: unknown[]) => {
              seen.push(JSON.stringify(args));
              return target.bind(...args);
            };
          }
          const value: unknown = Reflect.get(target, key);
          return typeof value === 'function'
            ? (value as (...a: unknown[]) => unknown).bind(target)
            : value;
        },
      });
    },
    batch: (s: Parameters<typeof real.batch>[0]) => real.batch(s),
  } as typeof real;
  return seen;
}

describe('cliente real ↔ servidor real', () => {
  it(
    'el espacio creado por `createVault` se acepta, y el acceso con `preparePassword` abre la clave maestra con lo que guardó el servidor',
    async () => {
      const h = makeHarness();
      const created = (await createVault(PASSWORD)) as unknown as Created;

      const setup = await h.call('POST', '/api/setup', { body: setupPayload(created) });
      expect(setup.status, setup.text).toBe(200);

      const params = await h.call('GET', '/api/auth/params');
      expect(params.json?.configured).toBe(true);
      expect(params.json?.kdf).toBe(created.wire.kdf); // el servidor devuelve el registro tal cual, sin reescribirlo

      const material = await preparePassword(PASSWORD, params.json?.kdf as string);
      const login = await h.call('POST', '/api/auth/login', {
        body: { auth_pw: (material as unknown as { authPw: string }).authPw },
      });
      expect(login.status, login.text).toBe(200);
      expect(login.json?.wrapped_mk_pw).toBe(created.wire.wrappedMkPw);

      const keyring = await unwrapWithPassword(material, {
        ...created.wire,
        wrappedMkPw: login.json?.wrapped_mk_pw as string,
      });
      expect(keyring).toBeDefined();
      keyring.lock();
      disposeMaterial(material);
    },
    TIMEOUT,
  );

  it(
    'el servidor nunca recibe la contraseña ni la clave de recuperación (ni en el alta ni en el acceso) y no los guarda',
    async () => {
      const h = makeHarness();
      const seen = wireLog(h);
      const created = (await createVault(PASSWORD)) as unknown as Created;
      const body = setupPayload(created);
      expect(JSON.stringify(body)).not.toContain(PASSWORD);
      expect(JSON.stringify(body)).not.toContain(created.recoveryKey);
      expect(JSON.stringify(body)).not.toContain(created.recoveryKey.replace(/[-\s]/g, ''));

      expect((await h.call('POST', '/api/setup', { body })).status).toBe(200);
      const material = await preparePassword(PASSWORD, created.wire.kdf);
      const authPw = (material as unknown as { authPw: string }).authPw;
      expect((await h.call('POST', '/api/auth/login', { body: { auth_pw: authPw } })).status).toBe(
        200,
      );
      disposeMaterial(material);

      const everything = JSON.stringify([
        seen,
        h.raw.prepare('SELECT * FROM account').all(),
        h.raw.prepare('SELECT * FROM vault').all(),
        h.raw.prepare('SELECT * FROM security_event').all(),
      ]);
      for (const secret of [
        PASSWORD,
        created.recoveryKey,
        created.recoveryKey.replace(/[-\s]/g, ''),
        authPw,
        created.authRec,
      ]) {
        expect(everything, 'un secreto aparece en lo que ve o guarda el servidor').not.toContain(
          secret,
        );
      }
      // En D1 solo hay HMAC(PEPPER, secreto): 43 caracteres base64url, distinto del propio secreto.
      const account = h.raw.prepare('SELECT auth_hash, recovery_auth_hash FROM account').get() as {
        auth_hash: string;
        recovery_auth_hash: string;
      };
      expect(account.auth_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(account.auth_hash).not.toBe(authPw);
      expect(account.recovery_auth_hash).not.toBe(created.authRec);
    },
    TIMEOUT,
  );

  it(
    'una contraseña distinta deriva otro `auth_pw` y el servidor lo rechaza con el error genérico',
    async () => {
      const h = makeHarness();
      const created = (await createVault(PASSWORD)) as unknown as Created;
      expect((await h.call('POST', '/api/setup', { body: setupPayload(created) })).status).toBe(
        200,
      );
      const material = await preparePassword(PASSWORD + 'x', created.wire.kdf);
      const r = await h.call('POST', '/api/auth/login', {
        body: { auth_pw: (material as unknown as { authPw: string }).authPw },
      });
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ error: 'invalid_credentials' });
      disposeMaterial(material);
    },
    TIMEOUT,
  );
});
