import { describe, expect, it } from 'vitest';
import type { MemoryFields } from '@/features/calendar';
import {
  beginSetup,
  readStatus,
  startRecovery,
  unlock,
  AccessError,
} from '@/features/access/access-flow';
import { changeOwnPassword } from '@/features/access/credentials-flow';
import { createGardenSource } from '@/features/access/garden-source';
import {
  openBackupWithPassword,
  openBackupWithRecoveryKey,
  uploadBackup,
} from '@/features/access/restore-flow';
import { buildSeedPayloads } from '@/dev/seed-data';
import { BackupError, createBackupSource, exportSpace } from '@/lib/backup';
import type { Keyring } from '@/lib/crypto';
import { createRemoteRepository } from '@/lib/remote/remote-repository';
import { createSettingsSource, defaultSettings } from '@/lib/settings';
import { rows } from './server/_d1';
import { SETUP_CODE, makeHarness, type Harness } from './server/_support';
import { FAST, bridge, type Bridge } from './_access-helpers';

/**
 * H8.3 · copia cifrada `.mgx` contra el Worker real (D1 y R2 simulados). Criterio de aceptación de H8:
 * «exportar → borrar todo → importar devuelve los mismos recuerdos y fotos». Aquí «borrar todo» es un servidor nuevo y vacío
 * (lo que queda tras perder D1 o eliminar el espacio); el borrado desde la app llega en H8.3b.
 */
const PASSWORD = 'correcto caballo bateria grapa 2026';
const NEW_PASSWORD = 'otra frase muy larga para el jardin';
const TIMEOUT = 180_000;

const { photos: _ignored, ...FIELDS } = buildSeedPayloads()[0]!;
void _ignored;
const fields = (title: string): MemoryFields => ({ ...FIELDS, title });
const jpeg = (n: number, seed: number) =>
  Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255);

interface Space {
  h: Harness;
  b: Bridge;
  keyring: Keyring;
  recoveryKey: string;
}

async function newSpace(): Promise<Space> {
  const h = makeHarness();
  const b = bridge(h);
  const pending = await beginSetup(b.client, PASSWORD, FAST);
  const keyring = await pending.submit(SETUP_CODE);
  return { h, b, keyring, recoveryKey: pending.recoveryKey };
}

const repoOf = (b: Bridge) => createRemoteRepository({ fetch: b.fetch });

/** Espacio con 3 recuerdos (2 con fotos), uno en la papelera, ajustes con avatar propio. */
async function filled() {
  const s = await newSpace();
  const repo = repoOf(s.b);
  const garden = createGardenSource(repo, s.keyring);
  const a = await garden.create({
    fields: fields('Con dos fotos'),
    photos: [
      { photo: jpeg(3000, 1), thumb: jpeg(400, 2), alt: 'primera' },
      { photo: jpeg(2500, 3), thumb: jpeg(300, 4), alt: 'segunda' },
    ],
  });
  const b = await garden.create({
    fields: fields('Con una foto'),
    photos: [{ photo: jpeg(1800, 5), thumb: jpeg(200, 6), alt: 'sola' }],
  });
  const c = await garden.create({ fields: fields('Sin fotos'), photos: [] });
  await garden.list();
  const trashed = await garden.create({ fields: fields('En la papelera'), photos: [] });
  await garden.list();
  await garden.trash(trashed.memory.id);

  const settings = createSettingsSource(repo, s.keyring);
  const avatarId = await settings.uploadAvatar(jpeg(900, 9));
  const value = {
    ...defaultSettings('es'),
    displayName: 'Lucía',
    welcomeMessage: 'Hola',
    avatar: { kind: 'asset' as const, assetId: avatarId },
  };
  await settings.save(value, 0);
  await settings.save({ ...value, welcomeMessage: 'Hola de nuevo' }, 1); // revisión 2: el AAD cambia
  return { ...s, repo, garden, ids: [a.memory.id, b.memory.id, c.memory.id], avatarId };
}

async function snapshot(repo: ReturnType<typeof repoOf>, keyring: Keyring) {
  const garden = createGardenSource(repo, keyring);
  const list = (await garden.list()).sort((x, y) => x.id.localeCompare(y.id));
  const photos: Record<string, Uint8Array> = {};
  for (const m of list)
    for (const [i, p] of m.photos.entries()) {
      const full = await keyring.openAsset(
        p.assetId,
        'photo',
        m.id,
        await repo.assets.getBytes(p.assetId),
      );
      const thumb = await keyring.openAsset(
        p.thumbId,
        'thumb',
        m.id,
        await repo.assets.getBytes(p.thumbId),
      );
      photos[`${m.id}/${i}`] = full;
      photos[`${m.id}/${i}/t`] = thumb;
    }
  const settings = await createSettingsSource(repo, keyring).load();
  return {
    memories: list.map(({ updatedAt: _u, ...rest }) => (void _u, rest)),
    photos,
    settings: settings.settings,
  };
}

describe('exportar → espacio vacío → restaurar', () => {
  it(
    'con la contraseña: mismos recuerdos, fotos, ajustes y avatar; la papelera no se copia; clave de recuperación nueva',
    async () => {
      const src = await filled();
      const before = await snapshot(src.repo, src.keyring);
      const out = await exportSpace(src.repo, src.keyring, {
        now: new Date('2026-10-31T10:00:00Z'),
      });
      expect(out.fileName).toBe('memory-garden-2026-10-31.mgx');
      expect(out.summary).toMatchObject({ memories: 3, photos: 3, missing: 0, unreadable: 0 });
      const head = new Uint8Array(await out.blob.slice(0, 4).arrayBuffer());
      expect(String.fromCharCode(...head)).toBe('MGX1');
      // El archivo no contiene nada en claro: ni títulos, ni nombre, ni la contraseña.
      const text = new TextDecoder().decode(new Uint8Array(await out.blob.arrayBuffer()));
      for (const secret of ['Con dos fotos', 'Lucía', 'Hola de nuevo', 'caballo', 'primera'])
        expect(text).not.toContain(secret);

      const dst = makeHarness();
      const b = bridge(dst);
      const progress: string[] = [];
      const unlocked = await openBackupWithPassword(b.client, out.blob, PASSWORD, FAST, (p) =>
        progress.push(`${p.phase}:${p.done}/${p.total}`),
      );
      expect(unlocked.mode).toBe('password');
      expect(unlocked.counts.memories).toBe(3);
      expect(progress.at(-1)).toMatch(/^verify:/);
      expect(b.requests).toEqual([]); // nada enviado al abrir y comprobar

      const pending = await unlocked.prepare();
      expect(pending.recoveryKey).not.toBe(src.recoveryKey);
      const keyring = await pending.submit(SETUP_CODE);
      const summary = await uploadBackup(keyring, unlocked.backup, undefined, b.fetch);
      expect(summary).toMatchObject({
        total: 3,
        restored: 3,
        skipped: 0,
        photos: 3,
        settings: true,
      });

      const after = await snapshot(repoOf(b), keyring);
      expect(after).toEqual(before);
      expect(rows(dst.raw, 'SELECT id FROM vault')).toEqual(
        rows(src.h.raw, 'SELECT id FROM vault'),
      );

      // Se entra con la MISMA contraseña; la clave de recuperación antigua ya no vale y la nueva sí.
      const status = await readStatus(bridge(dst).client);
      if (!status.configured) throw new Error('espacio sin crear');
      await unlock(bridge(dst).client, status, PASSWORD, FAST);
      await expect(
        startRecovery(bridge(dst).client, status, src.recoveryKey, FAST),
      ).rejects.toThrow(AccessError);
      (await startRecovery(bridge(dst).client, status, pending.recoveryKey, FAST)).discard();
    },
    TIMEOUT,
  );

  it(
    'con la clave de recuperación: pide contraseña nueva y genera clave nueva; los datos son los mismos',
    async () => {
      const src = await filled();
      const before = await snapshot(src.repo, src.keyring);
      const out = await exportSpace(src.repo, src.keyring);
      const dst = makeHarness();
      const b = bridge(dst);
      const unlocked = await openBackupWithRecoveryKey(b.client, out.blob, src.recoveryKey, FAST);
      expect(unlocked.mode).toBe('recovery');
      await expect(unlocked.prepare('corta')).rejects.toThrow(AccessError);
      const pending = await unlocked.prepare(NEW_PASSWORD);
      const keyring = await pending.submit(SETUP_CODE);
      await uploadBackup(keyring, unlocked.backup, undefined, b.fetch);
      expect(await snapshot(repoOf(b), keyring)).toEqual(before);
      const status = await readStatus(bridge(dst).client);
      if (!status.configured) throw new Error('espacio sin crear');
      await unlock(bridge(dst).client, status, NEW_PASSWORD, FAST);
      await expect(unlock(bridge(dst).client, status, PASSWORD, FAST)).rejects.toThrow(AccessError);
    },
    TIMEOUT,
  );

  it(
    'una copia hecha antes de cambiar la contraseña se abre con la contraseña ANTIGUA (lleva su propia envoltura)',
    async () => {
      const src = await filled();
      const out = await exportSpace(src.repo, src.keyring);
      await changeOwnPassword(src.b.client, PASSWORD, NEW_PASSWORD, FAST);
      const b = bridge(makeHarness());
      await expect(
        openBackupWithPassword(b.client, out.blob, NEW_PASSWORD, FAST),
      ).rejects.toMatchObject({
        code: 'credentials',
      });
      (await openBackupWithPassword(b.client, out.blob, PASSWORD, FAST)).discard();
    },
    TIMEOUT,
  );
});

describe('archivos que no se deben restaurar', () => {
  it(
    'contraseña incorrecta: `credentials` y nada enviado',
    async () => {
      const src = await filled();
      const out = await exportSpace(src.repo, src.keyring);
      const b = bridge(makeHarness());
      await expect(
        openBackupWithPassword(b.client, out.blob, 'no es la contraseña buena', FAST),
      ).rejects.toMatchObject({ code: 'credentials' });
      expect(b.requests).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'un byte cambiado en una foto, en el manifiesto o en la cabecera: `corrupt` antes de crear nada',
    async () => {
      const src = await filled();
      const out = await exportSpace(src.repo, src.keyring);
      const bytes = new Uint8Array(await out.blob.arrayBuffer());
      const flip = (at: number) => {
        const copy = bytes.slice();
        copy[at] = (copy[at] ?? 0) ^ 0x01;
        return new Blob([copy]);
      };
      const headerLength = new DataView(bytes.buffer).getUint32(8, false);
      const manifestAt = 12 + headerLength + 4;
      // Último byte (una miniatura), un byte del manifiesto y el id de exportación de la cabecera.
      for (const [at, code] of [
        [bytes.length - 1, 'corrupt'],
        [manifestAt + 40, 'corrupt'],
      ] as const) {
        const b = bridge(makeHarness());
        await expect(
          openBackupWithPassword(b.client, flip(at), PASSWORD, FAST),
        ).rejects.toMatchObject({
          code,
        });
        expect(b.requests).toEqual([]);
      }
      const truncated = new Blob([bytes.slice(0, bytes.length - 10)]);
      await expect(
        openBackupWithPassword(bridge(makeHarness()).client, truncated, PASSWORD, FAST),
      ).rejects.toMatchObject({ code: 'corrupt' });
      await expect(
        openBackupWithPassword(bridge(makeHarness()).client, new Blob(['hola']), PASSWORD, FAST),
      ).rejects.toMatchObject({ code: 'format' });
      // Cabecera editada (cambiar el export_id de otro valor válido): el manifiesto ya no se abre.
      const head = new TextDecoder().decode(bytes.slice(12, 12 + headerLength));
      const edited = head.replace(
        /"export_id":"(.)/,
        (_m, c: string) => `"export_id":"${c === 'A' ? 'B' : 'A'}`,
      );
      const swapped = new Blob([
        bytes.slice(0, 12),
        new TextEncoder().encode(edited),
        bytes.slice(12 + headerLength),
      ]);
      await expect(
        openBackupWithPassword(bridge(makeHarness()).client, swapped, PASSWORD, FAST),
      ).rejects.toMatchObject({ code: 'corrupt' });
    },
    TIMEOUT,
  );

  it(
    'restaurar sobre un espacio que ya existe: el servidor lo rechaza (D-101) y no se sube nada',
    async () => {
      const src = await filled();
      const out = await exportSpace(src.repo, src.keyring);
      const b = bridge(src.h); // MISMO servidor, que ya tiene espacio
      const unlocked = await openBackupWithPassword(b.client, out.blob, PASSWORD, FAST);
      const pending = await unlocked.prepare();
      await expect(pending.submit(SETUP_CODE)).rejects.toMatchObject({ code: 'setup_rejected' });
    },
    TIMEOUT,
  );

  it(
    'continuar desde Configuración con la copia de OTRO espacio: `other_space`',
    async () => {
      const a = await filled();
      const other = await newSpace();
      const out = await exportSpace(a.repo, a.keyring);
      const source = createBackupSource(repoOf(other.b), other.keyring);
      await expect(source.continueRestore(out.blob)).rejects.toMatchObject({ code: 'other_space' });
    },
    TIMEOUT,
  );
});

describe('restauración interrumpida', () => {
  it(
    'si se corta a mitad, continuar con el mismo archivo completa lo que falta sin duplicar nada',
    async () => {
      const src = await filled();
      const before = await snapshot(src.repo, src.keyring);
      const out = await exportSpace(src.repo, src.keyring);
      const dst = makeHarness();
      const b = bridge(dst);
      const unlocked = await openBackupWithPassword(b.client, out.blob, PASSWORD, FAST);
      const keyring = await (await unlocked.prepare()).submit(SETUP_CODE);

      // La red se cae tras la segunda subida de foto.
      let puts = 0;
      const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/api/assets/') && init?.method === 'PUT' && ++puts > 2)
          throw new TypeError('network');
        return b.fetch(input, init);
      }) as typeof fetch;
      await expect(uploadBackup(keyring, unlocked.backup, undefined, flaky)).rejects.toThrow(
        BackupError,
      );

      const source = createBackupSource(repoOf(b), keyring);
      const summary = await source.continueRestore(out.blob);
      expect(summary.restored + summary.skipped).toBe(3);
      expect(summary.settings).toBe(false); // ya se aplicaron en la primera pasada
      expect(await snapshot(repoOf(b), keyring)).toEqual(before);
      const again = await source.continueRestore(out.blob);
      expect(again).toMatchObject({ restored: 0, skipped: 3 });
      expect(rows(dst.raw, 'SELECT id FROM memory').length).toBe(3);
    },
    TIMEOUT,
  );
});
