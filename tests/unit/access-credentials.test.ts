import { describe, expect, it } from 'vitest';
import {
  AccessError,
  beginSetup,
  readStatus,
  startRecovery,
  unlock,
  type SpaceStatus,
} from '@/features/access/access-flow';
import { beginRecoveryKeyRotation, changeOwnPassword } from '@/features/access/credentials-flow';
import { createGardenSource } from '@/features/access/garden-source';
import { buildSeedPayloads } from '@/dev/seed-data';
import { createRemoteRepository } from '@/lib/remote/remote-repository';
import { rows } from './server/_d1';
import { SETUP_CODE, makeHarness, type Harness } from './server/_support';
import { FAST, bridge } from './_access-helpers';

/**
 * H8.2 · cambiar la contraseña y generar una clave de recuperación nueva desde Configuración, contra el Worker real
 * (D1 y R2 simulados). Criterio de aceptación de H8: «cambiar contraseña no obliga a recifrar datos y los datos siguen
 * abriéndose».
 */
const PASSWORD = 'correcto caballo bateria grapa 2026';
const NEW_PASSWORD = 'otra frase muy larga para el jardin';
const TIMEOUT = 120_000;

const { photos: _ignored, ...FIELDS } = buildSeedPayloads()[0]!;
void _ignored;

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

describe('cambiar la contraseña', () => {
  it(
    'la nueva abre las mismas claves y los mismos recuerdos; la antigua deja de valer; nada se vuelve a cifrar',
    async () => {
      const h = makeHarness();
      const { b, keyring } = await createSpace(h);
      const garden = createGardenSource(createRemoteRepository({ fetch: b.fetch }), keyring);
      const created = await garden.create({
        fields: { ...FIELDS, title: 'Recuerdo antes del cambio' },
        photos: [],
      });
      const before = rows<{ payload: string; revision: number }>(
        h.raw,
        'SELECT payload, revision FROM memory',
      );

      await changeOwnPassword(b.client, PASSWORD, NEW_PASSWORD, FAST);

      // Los recuerdos no se han tocado: mismo sobre cifrado y misma revisión.
      expect(rows(h.raw, 'SELECT payload, revision FROM memory')).toEqual(before);
      // Esta pestaña sigue funcionando con sus claves en memoria (la cookie se renovó).
      expect((await garden.list()).map((m) => m.id)).toEqual([created.memory.id]);

      const status = await configured(h);
      expect((await failure(unlock(bridge(h).client, status, PASSWORD, FAST))).code).toBe(
        'wrong_credentials',
      );
      const other = bridge(h);
      const { keyring: reopened } = await unlock(other.client, status, NEW_PASSWORD, FAST);
      const fresh = createGardenSource(createRemoteRepository({ fetch: other.fetch }), reopened);
      expect((await fresh.list()).map((m) => m.title)).toEqual(['Recuerdo antes del cambio']);
    },
    TIMEOUT,
  );

  it(
    'contraseña actual incorrecta: error genérico y no cambia nada',
    async () => {
      const h = makeHarness();
      const { b } = await createSpace(h);
      expect(
        (
          await failure(
            changeOwnPassword(b.client, 'no es la contraseña buena', NEW_PASSWORD, FAST),
          )
        ).code,
      ).toBe('wrong_credentials');
      await unlock(bridge(h).client, await configured(h), PASSWORD, FAST); // la de siempre sigue valiendo
    },
    TIMEOUT,
  );

  it(
    'contraseña nueva inválida, repetida o igual a la actual: `policy` sin enviar nada',
    async () => {
      const h = makeHarness();
      const { b } = await createSpace(h);
      const before = b.requests.length;
      for (const bad of ['corta', 'teamoteamoteamo', PASSWORD])
        expect((await failure(changeOwnPassword(b.client, PASSWORD, bad, FAST))).code).toBe(
          'policy',
        );
      expect(b.requests.length).toBe(before);
      expect(b.sent.join('\n')).not.toContain('teamo');
    },
    TIMEOUT,
  );

  it(
    'respuesta perdida: se reconoce que el cambio se aplicó (no se da por fallido)',
    async () => {
      const h = makeHarness();
      const { b } = await createSpace(h);
      b.loseNextResponse('/api/vault/password');
      await changeOwnPassword(b.client, PASSWORD, NEW_PASSWORD, FAST);
      await unlock(bridge(h).client, await configured(h), NEW_PASSWORD, FAST);
    },
    TIMEOUT,
  );

  it(
    'nunca envía la contraseña actual ni la nueva al servidor',
    async () => {
      const h = makeHarness();
      const { b } = await createSpace(h);
      await changeOwnPassword(b.client, PASSWORD, NEW_PASSWORD, FAST);
      const sent = b.sent.join('\n');
      expect(sent).not.toContain('caballo');
      expect(sent).not.toContain('jardin');
    },
    TIMEOUT,
  );
});

describe('clave de recuperación nueva', () => {
  it(
    'hasta confirmarla, la anterior sigue valiendo; al activarla, la anterior deja de valer y la nueva funciona',
    async () => {
      const h = makeHarness();
      const { b, recoveryKey: oldKey } = await createSpace(h);
      const pending = await beginRecoveryKeyRotation(b.client, PASSWORD, FAST);
      expect(pending.recoveryKey).not.toBe(oldKey);

      let status = await configured(h);
      (await startRecovery(bridge(h).client, status, oldKey, FAST)).discard(); // todavía vale

      await pending.activate();
      status = await configured(h);
      expect((await failure(startRecovery(bridge(h).client, status, oldKey, FAST))).code).toBe(
        'wrong_credentials',
      );
      (await startRecovery(bridge(h).client, status, pending.recoveryKey, FAST)).discard();
      // La contraseña no cambia.
      await unlock(bridge(h).client, status, PASSWORD, FAST);
    },
    TIMEOUT,
  );

  it(
    'abandonar no cambia nada',
    async () => {
      const h = makeHarness();
      const { b, recoveryKey: oldKey } = await createSpace(h);
      const pending = await beginRecoveryKeyRotation(b.client, PASSWORD, FAST);
      pending.discard();
      expect((await failure(pending.activate())).code).toBe('unavailable');
      (await startRecovery(bridge(h).client, await configured(h), oldKey, FAST)).discard();
    },
    TIMEOUT,
  );

  it(
    'respuesta perdida al activar: se reconoce que la nueva ya está activa',
    async () => {
      const h = makeHarness();
      const { b } = await createSpace(h);
      const pending = await beginRecoveryKeyRotation(b.client, PASSWORD, FAST);
      b.loseNextResponse('/api/vault/recovery-key');
      await pending.activate();
      (
        await startRecovery(bridge(h).client, await configured(h), pending.recoveryKey, FAST)
      ).discard();
    },
    TIMEOUT,
  );

  it(
    'si otro dispositivo cambió las claves entre medias: `conflict` y la clave anterior sigue valiendo',
    async () => {
      const h = makeHarness();
      const { b, recoveryKey: oldKey } = await createSpace(h);
      const pending = await beginRecoveryKeyRotation(b.client, PASSWORD, FAST);
      const other = bridge(h);
      await changeOwnPassword(other.client, PASSWORD, NEW_PASSWORD, FAST);
      expect((await failure(pending.activate())).code).toMatch(/conflict|session_expired/);
      (await startRecovery(bridge(h).client, await configured(h), oldKey, FAST)).discard();
    },
    TIMEOUT,
  );

  it(
    'contraseña actual incorrecta: no se genera nada',
    async () => {
      const h = makeHarness();
      const { b } = await createSpace(h);
      expect(
        (await failure(beginRecoveryKeyRotation(b.client, 'no es la contraseña buena', FAST))).code,
      ).toBe('wrong_credentials');
    },
    TIMEOUT,
  );
});
