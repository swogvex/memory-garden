import { describe, expect, it } from 'vitest';
import type { GardenSource, MemoryFields } from '@/features/calendar';
import { AccessError, beginSetup, readStatus, unlock } from '@/features/access/access-flow';
import { deleteAllMemories, deleteWholeSpace } from '@/features/access/danger-flow';
import { createGardenSource } from '@/features/access/garden-source';
import { openBackupWithPassword, uploadBackup } from '@/features/access/restore-flow';
import { buildSeedPayloads } from '@/dev/seed-data';
import { exportSpace } from '@/lib/backup';
import type { Keyring } from '@/lib/crypto';
import { createRemoteRepository } from '@/lib/remote/remote-repository';
import { createSettingsSource, defaultSettings } from '@/lib/settings';
import { TRASH_DAYS, type Repository } from '@/lib/storage';
import { createTrashSource } from '@/lib/trash';
import { SETUP_CODE, count, makeHarness, type Harness } from './server/_support';
import { FAST, bridge, type Bridge } from './_access-helpers';

/**
 * Papelera, «Borrar todos los recuerdos» y «Eliminar el espacio» desde el cliente, contra el Worker real
 * (D1 y R2 simulados). Incluye el criterio de aceptación completo: exportar → ELIMINAR el espacio → código nuevo →
 * restaurar ⇒ los mismos recuerdos y fotos.
 */
const PASSWORD = 'correcto caballo bateria grapa 2026';
const TIMEOUT = 180_000;
const NEW_CODE = 'NUEVO-CODIG-ODECO-NFIGU-RACI0';

const { photos: _ignored, ...FIELDS } = buildSeedPayloads()[0]!;
void _ignored;
const fields = (title: string): MemoryFields => ({ ...FIELDS, title });
const jpeg = (n: number, seed: number) =>
  Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255);

interface Space {
  h: Harness;
  b: Bridge;
  garden: GardenSource;
  repo: Repository;
  keyring: Keyring;
}

async function space(): Promise<Space> {
  const h = makeHarness();
  const b = bridge(h);
  const keyring = await (await beginSetup(b.client, PASSWORD, FAST)).submit(SETUP_CODE);
  const repo = createRemoteRepository({ fetch: b.fetch });
  const garden = createGardenSource(repo, keyring);
  return { h, b, garden, repo, keyring };
}

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof AccessError) return e.code;
    throw e;
  }
  return 'ok';
};

describe('papelera', () => {
  it(
    'lista lo de la papelera con su título y su fecha de borrado; restaurar lo devuelve; borrar para siempre lo quita con sus fotos',
    async () => {
      const s = await space();
      const a = await s.garden.create({
        fields: fields('Paseo'),
        photos: [{ photo: jpeg(2000, 1), thumb: jpeg(300, 2), alt: 'foto' }],
      });
      const b = await s.garden.create({ fields: fields('Cena'), photos: [] });
      await s.garden.list();
      await s.garden.trash(a.memory.id);
      await s.garden.trash(b.memory.id);
      const trash = createTrashSource(s.repo, s.keyring);
      const items = await trash.list();
      expect(items.map((i) => i.title).sort()).toEqual(['Cena', 'Paseo']);
      for (const i of items) expect(i.purgeAt - i.deletedAt).toBe(TRASH_DAYS * 86_400);

      await trash.restore(items.find((i) => i.title === 'Cena')!);
      expect((await s.garden.list()).map((m) => m.title)).toEqual(['Cena']);

      const r2Before = s.h.r2.store.size;
      await trash.purge((await trash.list())[0]!);
      expect(await trash.list()).toEqual([]);
      expect(s.h.r2.store.size).toBe(r2Before - 2); // foto y miniatura
    },
    TIMEOUT,
  );
});

describe('borrar todos los recuerdos', () => {
  it(
    'contraseña incorrecta: nada cambia; correcta: jardín y papelera vacíos, ajustes intactos y se sigue dentro',
    async () => {
      const s = await space();
      await s.garden.create({ fields: fields('Uno'), photos: [] });
      const two = await s.garden.create({ fields: fields('Dos'), photos: [] });
      await s.garden.list();
      await s.garden.trash(two.memory.id);
      await createSettingsSource(s.repo, s.keyring).save(
        { ...defaultSettings('es'), displayName: 'Lucía' },
        0,
      );

      expect(await code(deleteAllMemories(s.b.client, 'no es la contraseña buena', FAST))).toBe(
        'wrong_credentials',
      );
      expect(count(s.h.raw, 'memory')).toBe(2);

      await deleteAllMemories(s.b.client, PASSWORD, FAST);
      expect(await s.garden.list()).toEqual([]);
      expect(await createTrashSource(s.repo, s.keyring).list()).toEqual([]);
      const kept = await createSettingsSource(s.repo, s.keyring).load();
      expect(kept.settings?.displayName).toBe('Lucía');
      expect(s.b.sent.join('\n')).not.toContain('caballo');
    },
    TIMEOUT,
  );
});

describe('eliminar el espacio', () => {
  it(
    'tras eliminarlo no se puede entrar ni crear otro con el mismo código; con uno NUEVO sí',
    async () => {
      const s = await space();
      await s.garden.create({ fields: fields('Uno'), photos: [] });
      expect(await code(deleteWholeSpace(s.b.client, 'no es la contraseña buena', FAST))).toBe(
        'wrong_credentials',
      );
      await deleteWholeSpace(s.b.client, PASSWORD, FAST);
      expect(await readStatus(bridge(s.h).client)).toEqual({ configured: false });
      expect(s.h.r2.store.size).toBe(0);

      const again = await beginSetup(bridge(s.h).client, PASSWORD, FAST);
      expect(await code(again.submit(SETUP_CODE))).toBe('setup_rejected');
      s.h.env.SETUP_CODE = NEW_CODE;
      await again.submit(NEW_CODE);
      const status = await readStatus(bridge(s.h).client);
      if (!status.configured) throw new Error('espacio sin crear');
      await unlock(bridge(s.h).client, status, PASSWORD, FAST);
    },
    TIMEOUT,
  );

  it(
    'si se pierde la respuesta, se reconoce que el espacio ya se eliminó',
    async () => {
      const s = await space();
      s.b.loseNextResponse('/api/vault/delete');
      await deleteWholeSpace(s.b.client, PASSWORD, FAST);
      expect(count(s.h.raw, 'account')).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'exportar → eliminar el espacio → código nuevo → restaurar devuelve los mismos recuerdos y fotos',
    async () => {
      const s = await space();
      await s.garden.create({
        fields: fields('Con foto'),
        photos: [{ photo: jpeg(2400, 7), thumb: jpeg(350, 8), alt: 'foto' }],
      });
      await s.garden.create({ fields: fields('Sin foto'), photos: [] });
      const before = (await s.garden.list()).map(({ updatedAt: _u, ...m }) => (void _u, m));
      const out = await exportSpace(s.repo, s.keyring);

      await deleteWholeSpace(s.b.client, PASSWORD, FAST);
      s.h.env.SETUP_CODE = NEW_CODE;

      const b = bridge(s.h);
      const unlocked = await openBackupWithPassword(b.client, out.blob, PASSWORD, FAST);
      const keyring = await (await unlocked.prepare()).submit(NEW_CODE);
      await uploadBackup(keyring, unlocked.backup, undefined, b.fetch);

      const garden = createGardenSource(createRemoteRepository({ fetch: b.fetch }), keyring);
      const after = (await garden.list()).map(({ updatedAt: _u, ...m }) => (void _u, m));
      const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id);
      expect(after.sort(byId)).toEqual(before.sort(byId));
      const m = (await garden.list()).find((x) => x.title === 'Con foto')!;
      const ref = m.photos[0]!;
      const repo = createRemoteRepository({ fetch: b.fetch });
      expect(
        await keyring.openAsset(
          ref.assetId,
          'photo',
          m.id,
          await repo.assets.getBytes(ref.assetId),
        ),
      ).toEqual(jpeg(2400, 7));
    },
    TIMEOUT,
  );
});
