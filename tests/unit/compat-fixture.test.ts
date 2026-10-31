import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MemoryFields } from '@/features/calendar';
import type { Tuning } from '@/features/access/access-flow';
import { beginSetup, readStatus, unlock } from '@/features/access/access-flow';
import { createGardenSource } from '@/features/access/garden-source';
import {
  openBackupWithPassword,
  openBackupWithRecoveryKey,
  uploadBackup,
} from '@/features/access/restore-flow';
import { buildSeedPayloads } from '@/dev/seed-data';
import { exportSpace } from '@/lib/backup';
import type { Keyring } from '@/lib/crypto';
import { createRemoteRepository } from '@/lib/remote/remote-repository';
import { createSettingsSource, defaultSettings } from '@/lib/settings';
import { rows } from './server/_d1';
import { SETUP_CODE, makeHarness } from './server/_support';
import { FAST, bridge, type Bridge } from './_access-helpers';

/**
 * Espacio de referencia (D-277). `tests/fixtures/compat-v1.mgx` es una copia cifrada hecha UNA VEZ con el código de
 * hoy y los parámetros de producción. Esta prueba la restaura en un servidor vacío con el código ACTUAL y comprueba
 * que todo se abre igual: recuerdos, fotos, avatar y ajustes, con la contraseña y con la clave de recuperación.
 *
 * Si falla tras un cambio, ese cambio rompe la lectura de datos que ya existen (los de la destinataria): NO se
 * regenera el archivo para que pase. Solo se regenera si se cambia el formato A PROPÓSITO y con migración, y
 * entonces se añade un compat-v2 sin borrar el v1.
 *
 * Regenerar (solo en ese caso): $env:MG_WRITE_FIXTURE='1'; npx vitest run tests/unit/compat-fixture.test.ts
 */
const PASSWORD = 'jardin de referencia para compatibilidad';
const NEW_PASSWORD = 'otra frase larga para la prueba de recuperacion';
const TIMEOUT = 180_000;
const MGX = fileURLToPath(new URL('../fixtures/compat-v1.mgx', import.meta.url));
const EXPECTED = fileURLToPath(new URL('../fixtures/compat-v1.expected.json', import.meta.url));
const WRITE = process.env.MG_WRITE_FIXTURE === '1';

/** Los mismos parámetros que un espacio real de producción (D-081). */
const PRODUCTION: Tuning = {
  vault: {
    policy: {
      minIter: 600_000,
      maxIter: 10_000_000,
      targetIter: 1_500_000,
      algs: ['pbkdf2-sha256'],
    },
    iter: 1_500_000,
  },
};

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const jpeg = (n: number, seed: number) =>
  Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255);
const repoOf = (b: Bridge) => createRemoteRepository({ fetch: b.fetch });

/** Lo que la persona ve: recuerdos (sin la hora de modificación), huella de cada foto y ajustes. */
async function snapshot(b: Bridge, keyring: Keyring) {
  const repo = repoOf(b);
  const garden = createGardenSource(repo, keyring);
  const list = (await garden.list()).sort((x, y) => x.id.localeCompare(y.id));
  const photos: Record<string, string> = {};
  for (const m of list)
    for (const [i, p] of m.photos.entries()) {
      photos[`${m.id}/${i}`] = sha(
        await keyring.openAsset(p.assetId, 'photo', m.id, await repo.assets.getBytes(p.assetId)),
      );
      photos[`${m.id}/${i}/t`] = sha(
        await keyring.openAsset(p.thumbId, 'thumb', m.id, await repo.assets.getBytes(p.thumbId)),
      );
    }
  const settings = await createSettingsSource(repo, keyring).load();
  const memories = list.map(({ updatedAt: _u, ...rest }) => (void _u, rest));
  // Ida y vuelta por JSON: así se compara exactamente con lo guardado en el archivo de referencia.
  return JSON.parse(JSON.stringify({ memories, photos, settings: settings.settings })) as unknown;
}

interface Expected {
  vaultId: string;
  recoveryKey: string;
  snapshot: unknown;
}

describe('espacio de referencia (compatibilidad con datos ya guardados)', () => {
  it.runIf(WRITE)(
    'GENERAR tests/fixtures/compat-v1.mgx (solo con MG_WRITE_FIXTURE=1)',
    async () => {
      const h = makeHarness();
      const b = bridge(h);
      const pending = await beginSetup(b.client, PASSWORD, PRODUCTION);
      const keyring = await pending.submit(SETUP_CODE);
      const repo = repoOf(b);
      const garden = createGardenSource(repo, keyring);
      const { photos: _ignored, ...base } = buildSeedPayloads()[0]!;
      void _ignored;
      const fields = (title: string): MemoryFields => ({ ...base, title });

      await garden.create({
        fields: { ...fields('Tarde en el río'), text: 'Texto con tildes, ñ y emoji 🌸' },
        photos: [
          { photo: jpeg(3000, 1), thumb: jpeg(400, 2), alt: 'el río' },
          { photo: jpeg(2500, 3), thumb: jpeg(300, 4), alt: 'las piedras' },
        ],
      });
      await garden.create({ fields: fields('Sin fotos'), photos: [] });
      await garden.list();
      const settings = createSettingsSource(repo, keyring);
      const avatarId = await settings.uploadAvatar(jpeg(900, 9));
      await settings.save(
        {
          ...defaultSettings('es'),
          displayName: 'Referencia',
          welcomeMessage: 'Hola',
          avatar: { kind: 'asset' as const, assetId: avatarId },
        },
        0,
      );

      const out = await exportSpace(repo, keyring, { now: new Date('2026-10-31T12:00:00Z') });
      mkdirSync(fileURLToPath(new URL('../fixtures/', import.meta.url)), { recursive: true });
      writeFileSync(MGX, new Uint8Array(await out.blob.arrayBuffer()));
      const expected: Expected = {
        vaultId: (rows(h.raw, 'SELECT id FROM vault')[0] as { id: string }).id,
        recoveryKey: pending.recoveryKey,
        snapshot: await snapshot(b, keyring),
      };
      writeFileSync(EXPECTED, JSON.stringify(expected, null, 2) + '\n');
    },
    TIMEOUT,
  );

  it(
    'con la contraseña: el código actual restaura exactamente lo mismo',
    async () => {
      expect(existsSync(MGX), 'falta tests/fixtures/compat-v1.mgx').toBe(true);
      const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as Expected;
      const blob = new Blob([readFileSync(MGX)]);

      const dst = makeHarness();
      const b = bridge(dst);
      const unlocked = await openBackupWithPassword(b.client, blob, PASSWORD, FAST);
      expect(unlocked.mode).toBe('password');
      const keyring = await (await unlocked.prepare()).submit(SETUP_CODE);
      await uploadBackup(keyring, unlocked.backup, undefined, b.fetch);

      expect(await snapshot(b, keyring)).toEqual(expected.snapshot);
      expect(rows(dst.raw, 'SELECT id FROM vault')).toEqual([{ id: expected.vaultId }]);

      // Y se puede volver a entrar con la misma contraseña (envoltura y parámetros del archivo).
      const status = await readStatus(bridge(dst).client);
      if (!status.configured) throw new Error('espacio sin crear');
      await unlock(bridge(dst).client, status, PASSWORD, FAST);
    },
    TIMEOUT,
  );

  it(
    'con la clave de recuperación: también se abre y los datos son los mismos',
    async () => {
      const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as Expected;
      const blob = new Blob([readFileSync(MGX)]);
      const b = bridge(makeHarness());
      const unlocked = await openBackupWithRecoveryKey(b.client, blob, expected.recoveryKey, FAST);
      const keyring = await (await unlocked.prepare(NEW_PASSWORD)).submit(SETUP_CODE);
      await uploadBackup(keyring, unlocked.backup, undefined, b.fetch);
      expect(await snapshot(b, keyring)).toEqual(expected.snapshot);
    },
    TIMEOUT,
  );
});
