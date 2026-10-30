import { describe, expect, it } from 'vitest';
import {
  AccessError,
  beginSetup,
  readStatus,
  startRecovery,
  unlock,
  type SpaceStatus,
} from '@/features/access/access-flow';
import { newId } from '@/lib/crypto';
import { SETUP_CODE, makeHarness, type Harness } from './server/_support';
import { FAST, bridge } from './_access-helpers';

/**
 * Flujos de acceso del cliente (lib/crypto real) contra el Worker real con D1 simulada (H7.3b).
 * Usa el mínimo de iteraciones que acepta el servidor (600.000): cada derivación tarda unas décimas de segundo.
 */
const PASSWORD = 'correcto caballo bateria grapa 2026';
const NEW_PASSWORD = 'otra frase muy larga para el jardin';
const TIMEOUT = 120_000;

async function createSpace(h: Harness) {
  const b = bridge(h);
  const pending = await beginSetup(b.client, PASSWORD, FAST);
  const keyring = await pending.submit(SETUP_CODE);
  return { b, keyring, recoveryKey: pending.recoveryKey };
}
const configured = async (h: Harness): Promise<Extract<SpaceStatus, { configured: true }>> => {
  const s = await readStatus(bridge(h).client);
  if (!s.configured) throw new Error('el espacio debería existir');
  return s;
};
const failure = async (p: Promise<unknown>): Promise<AccessError> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof AccessError) return e;
    throw e;
  }
  throw new Error('se esperaba un fallo');
};
/** Comprueba que dos `Keyring` comparten la clave maestra: lo que cifra uno lo abre el otro. */
async function sameKey(
  a: { sealMemory(id: string, v: number, x: unknown): Promise<string> },
  b: { openMemory(id: string, v: number, w: string): Promise<unknown> },
) {
  const id = newId();
  expect(await b.openMemory(id, 1, await a.sealMemory(id, 1, { hola: 'mundo' }))).toEqual({
    hola: 'mundo',
  });
}

describe('primer acceso', () => {
  it(
    'antes del alta el espacio no está configurado; con código incorrecto no se crea; con el correcto sí',
    async () => {
      const h = makeHarness();
      expect((await readStatus(bridge(h).client)).configured).toBe(false);
      const b = bridge(h);
      const pending = await beginSetup(b.client, PASSWORD, FAST);
      expect(pending.recoveryKey).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){6}$/);
      expect((await failure(pending.submit('AAAAA-AAAAA-AAAAA-AAAAA-AAAAA'))).code).toBe(
        'setup_rejected',
      );
      expect((await readStatus(b.client)).configured).toBe(false);
      const keyring = await pending.submit(SETUP_CODE);
      expect(keyring.isLocked).toBe(false);
      expect((await readStatus(b.client)).configured).toBe(true);
      keyring.lock();
    },
    TIMEOUT,
  );

  it('una contraseña que no cumple la política se rechaza antes de derivar nada', async () => {
    const h = makeHarness();
    const b = bridge(h);
    expect((await failure(beginSetup(b.client, 'corta', FAST))).code).toBe('policy');
    expect(b.requests).toEqual([]);
  });

  it(
    'si la respuesta del alta se pierde, el reintento reconoce que el alta era la suya y entra',
    async () => {
      const h = makeHarness();
      const b = bridge(h);
      const pending = await beginSetup(b.client, PASSWORD, FAST);
      b.loseNextResponse('/api/setup');
      expect((await failure(pending.submit(SETUP_CODE))).code).toBe('unavailable');
      const keyring = await pending.submit(SETUP_CODE); // el servidor ya tiene el espacio: se comprueba con login
      expect(keyring.isLocked).toBe(false);
      const status = await configured(h);
      const again = await unlock(bridge(h).client, status, PASSWORD, FAST);
      await sameKey(keyring, again.keyring);
    },
    TIMEOUT,
  );

  it(
    'abandonar el asistente suelta las claves y no deja nada en el servidor',
    async () => {
      const h = makeHarness();
      const b = bridge(h);
      const pending = await beginSetup(b.client, PASSWORD, FAST);
      pending.discard();
      expect((await failure(pending.submit(SETUP_CODE))).code).toBe('unavailable');
      expect((await readStatus(b.client)).configured).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'lo que sale del navegador no contiene la contraseña ni la clave de recuperación',
    async () => {
      const h = makeHarness();
      const b = bridge(h);
      const pending = await beginSetup(b.client, PASSWORD, FAST);
      await pending.submit(SETUP_CODE);
      const everything = b.sent.join('\n');
      expect(everything).not.toContain(PASSWORD);
      expect(everything).not.toContain(pending.recoveryKey);
      expect(everything).not.toContain(pending.recoveryKey.replace(/-/g, ''));
    },
    TIMEOUT,
  );
});

describe('acceso y desbloqueo', () => {
  it(
    'con la contraseña correcta abre las mismas claves; con otra, error genérico; una cookie nueva por acceso',
    async () => {
      const h = makeHarness();
      const created = await createSpace(h);
      const status = await configured(h);
      const b = bridge(h);
      const open = await unlock(b.client, status, PASSWORD, FAST);
      await sameKey(created.keyring, open.keyring);
      expect(b.jar.cookie).toMatch(/^[\w-]*mg_session=/);
      expect((await failure(unlock(bridge(h).client, status, PASSWORD + 'x', FAST))).code).toBe(
        'wrong_credentials',
      );
    },
    TIMEOUT,
  );

  it(
    'tras varios fallos el servidor frena y el cliente lo cuenta con la espera',
    async () => {
      const h = makeHarness();
      await createSpace(h);
      const status = await configured(h);
      const b = bridge(h, '203.0.113.7');
      let limited: AccessError | null = null;
      for (let i = 0; i < 8 && !limited; i++) {
        const e = await failure(
          unlock(b.client, status, `mala contraseña número ${i} larga`, FAST),
        );
        if (e.code === 'rate_limited') limited = e;
      }
      expect(limited?.code).toBe('rate_limited');
      expect(limited?.retryAfter ?? 0).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it('parámetros del servidor por debajo del suelo: se aborta ANTES de enviar nada', async () => {
    const h = makeHarness();
    const b = bridge(h);
    const weak = {
      configured: true as const,
      kdf: '{"v":1,"alg":"pbkdf2-sha256","iter":1000,"salt":"AAAAAAAAAAAAAAAAAAAAAA"}',
      recSalt: 'AAAAAAAAAAAAAAAAAAAAAA',
    };
    expect((await failure(unlock(b.client, weak, PASSWORD, FAST))).code).toBe('insecure_params');
    expect(b.requests).toEqual([]);
  });

  it(
    'con parámetros antiguos se actualizan solos tras entrar (más iteraciones, sal nueva) y se sigue pudiendo entrar',
    async () => {
      const h = makeHarness();
      await createSpace(h); // 600.000
      const before = await configured(h);
      const faster = {
        vault: {
          policy: {
            minIter: 600_000,
            maxIter: 10_000_000,
            targetIter: 700_000,
            algs: ['pbkdf2-sha256'],
          },
          iter: 700_000,
        },
      };
      const open = await unlock(bridge(h).client, before, PASSWORD, faster);
      const after = await configured(h);
      expect(JSON.parse(after.kdf).iter).toBe(700_000);
      expect(JSON.parse(after.kdf).salt).not.toBe(JSON.parse(before.kdf).salt);
      const again = await unlock(bridge(h).client, after, PASSWORD, faster);
      await sameKey(open.keyring, again.keyring);
    },
    TIMEOUT,
  );
});

describe('recuperación', () => {
  it(
    'un error de tecleo se detecta sin tocar la red',
    async () => {
      const h = makeHarness();
      const { recoveryKey } = await createSpace(h);
      const status = await configured(h);
      const b = bridge(h);
      const chars = recoveryKey.replace(/-/g, '');
      const typo = (chars[0] === '2' ? '3' : '2') + chars.slice(1);
      expect((await failure(startRecovery(b.client, status, typo, FAST))).code).toBe(
        'key_checksum',
      );
      expect((await failure(startRecovery(b.client, status, chars.slice(0, 10), FAST))).code).toBe(
        'key_format',
      );
      expect(b.requests).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'una clave bien escrita pero de otro espacio da el error genérico',
    async () => {
      const h = makeHarness();
      await createSpace(h);
      const other = await beginSetup(bridge(makeHarness()).client, PASSWORD, FAST); // otro espacio, otra clave
      other.discard();
      const status = await configured(h);
      expect(
        (await failure(startRecovery(bridge(h).client, status, other.recoveryKey, FAST))).code,
      ).toBe('wrong_credentials');
    },
    TIMEOUT,
  );

  it(
    'recuperar: contraseña nueva y clave nueva; las antiguas dejan de valer; los datos siguen abriéndose',
    async () => {
      const h = makeHarness();
      const created = await createSpace(h);
      const status = await configured(h);
      const b = bridge(h);
      // la clave se acepta en minúsculas y sin guiones
      const session = await startRecovery(
        b.client,
        status,
        created.recoveryKey.toLowerCase().replace(/-/g, ''),
        FAST,
      );
      expect((await failure(session.prepareReset('corta'))).code).toBe('policy');
      const pending = await session.prepareReset(NEW_PASSWORD);
      expect(pending.recoveryKey).not.toBe(created.recoveryKey);
      const recovered = await pending.submit();
      await sameKey(created.keyring, recovered);

      const fresh = await configured(h);
      expect((await failure(unlock(bridge(h).client, fresh, PASSWORD, FAST))).code).toBe(
        'wrong_credentials',
      );
      const entered = await unlock(bridge(h).client, fresh, NEW_PASSWORD, FAST);
      await sameKey(created.keyring, entered.keyring);
      expect(
        (await failure(startRecovery(bridge(h).client, fresh, created.recoveryKey, FAST))).code,
      ).toBe('wrong_credentials');
      const again = await startRecovery(bridge(h).client, fresh, pending.recoveryKey, FAST);
      again.discard();
    },
    TIMEOUT,
  );

  it(
    'si la sesión de recuperación caduca antes de enviar, se avisa y no se cambia nada',
    async () => {
      const h = makeHarness();
      const created = await createSpace(h);
      const status = await configured(h);
      const b = bridge(h);
      const session = await startRecovery(b.client, status, created.recoveryKey, FAST);
      const pending = await session.prepareReset(NEW_PASSWORD);
      h.clock.now += 16 * 60; // 15 min de sesión de recuperación
      expect((await failure(pending.submit())).code).toBe('session_expired');
      const entered = await unlock(bridge(h).client, await configured(h), PASSWORD, FAST); // la contraseña antigua sigue valiendo
      await sameKey(created.keyring, entered.keyring);
    },
    TIMEOUT,
  );
});
