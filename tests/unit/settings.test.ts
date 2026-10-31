import { describe, expect, it } from 'vitest';
import type { GardenMemory, GardenSource, SaveMemoryInput } from '@/features/calendar';
import { beginSetup } from '@/features/access/access-flow';
import { MoveError, moveCategory } from '@/features/settings/categories-flow';
import { createDevSpace } from '@/dev/seed';
import { createVault, disposeMaterial, preparePassword, unwrapWithPassword } from '@/lib/crypto';
import { createRemoteRepository } from '@/lib/remote/remote-repository';
import {
  SettingsError,
  addCategory,
  canAddCategory,
  canRemoveCategory,
  categoryNameIssue,
  createSettingsSource,
  defaultSettings,
  removeCategory,
  renameCategory,
  withCategories,
  type Category,
} from '@/lib/settings';
import { createDevMemoryRepository } from '@/lib/storage/dev-memory-adapter';
import { MAX_CATEGORIES, parseSettings, type Settings } from '@/lib/validation';
import { rows } from './server/_d1';
import { SETUP_CODE, makeHarness } from './server/_support';
import { FAST, bridge } from './_access-helpers';

/** Ajustes: modelo, fuente cifrada (desarrollo y servidor real simulado) y cambio de categoría de los recuerdos. */
const TIMEOUT = 120_000;
const PASSWORD = 'una frase larga para las pruebas de ajustes';

async function devKeys() {
  const repo = createDevMemoryRepository();
  const created = await createVault(PASSWORD, FAST.vault);
  const { wire } = created;
  await repo.vault.create({
    id: wire.vaultId,
    kdf: wire.kdf,
    mkVersion: wire.mkVersion,
    wrappedMkPw: wire.wrappedMkPw,
    recSalt: wire.recSalt,
    wrappedMkRec: wire.wrappedMkRec,
  });
  const material = await preparePassword(PASSWORD, wire.kdf, FAST.vault?.policy);
  const keyring = await unwrapWithPassword(material, wire);
  disposeMaterial(material);
  return { repo, keyring };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof SettingsError ? err.code : `otro:${String(err)}`;
  }
}

const cats = (...names: string[]): Category[] => names.map((name) => ({ name, flower: 'rosa' }));

describe('valores por defecto', () => {
  it('los ajustes de serie son válidos para el esquema cifrado, en español y en inglés', () => {
    for (const lang of ['es', 'en'] as const) {
      const s = defaultSettings(lang);
      expect(parseSettings(s)).toEqual(s);
      expect(s.language).toBe(lang);
      expect(s.timeZone).toBeNull();
      expect(s.avatar).toBeNull();
      expect(s.categories).toHaveLength(4);
    }
    expect(defaultSettings('es').categories.map((c) => c.name)).toEqual([
      'Viajes',
      'Momentos',
      'Naturaleza',
      'Citas',
    ]);
    // Flores de D-135, en el mismo orden en los dos idiomas.
    expect(defaultSettings('en').categories.map((c) => c.flower)).toEqual([
      'girasol',
      'camelia',
      'lavanda',
      'rosa',
    ]);
  });

  it('un documento sin categorías recupera las de serie (siempre hay al menos una)', () => {
    const empty: Settings = { ...defaultSettings('es'), categories: [] };
    expect(withCategories(empty).categories).toHaveLength(4);
    const own = { ...defaultSettings('es'), categories: cats('Solo una') };
    expect(withCategories(own)).toBe(own);
  });
});

describe('reglas de las categorías', () => {
  const list = cats('Viajes', 'Citas');

  it('nombre obligatorio, ≤ 40 caracteres, sin controles y sin repetir (sin distinguir mayúsculas ni espacios)', () => {
    expect(categoryNameIssue('', list)).toBe('settings.categories.error.required');
    expect(categoryNameIssue('   ', list)).toBe('settings.categories.error.required');
    expect(categoryNameIssue('a'.repeat(41), list)).toBe('settings.categories.error.long');
    expect(categoryNameIssue('a'.repeat(40), list)).toBeNull();
    expect(categoryNameIssue('mal\u0007nombre', list)).toBe('settings.categories.error.invalid');
    expect(categoryNameIssue(' viajes ', list)).toBe('settings.categories.error.duplicate');
    expect(categoryNameIssue('Familia', list)).toBeNull();
  });

  it('al renombrar, el propio nombre no cuenta como repetido', () => {
    expect(categoryNameIssue('VIAJES', list, 'Viajes')).toBeNull();
    expect(categoryNameIssue('Citas', list, 'Viajes')).toBe('settings.categories.error.duplicate');
  });

  it('añadir, renombrar y eliminar devuelven listas nuevas y respetan los límites', () => {
    const added = addCategory(list, '  Familia ', 'tulipan');
    expect(added.map((c) => c.name)).toEqual(['Viajes', 'Citas', 'Familia']);
    expect(list).toHaveLength(2); // sin mutar
    expect(renameCategory(added, 'Citas', 'Aniversarios', 'dalia')[1]).toEqual({
      name: 'Aniversarios',
      flower: 'dalia',
    });
    expect(removeCategory(added, 'Viajes').map((c) => c.name)).toEqual(['Citas', 'Familia']);
    expect(() => addCategory(list, 'viajes', 'rosa')).toThrow(SettingsError);
    expect(() => renameCategory(list, 'No existe', 'X', 'rosa')).toThrow(SettingsError);
  });

  it(`máximo ${MAX_CATEGORIES} y mínimo 1`, () => {
    const full = cats(...Array.from({ length: MAX_CATEGORIES }, (_, i) => `C${i}`));
    expect(canAddCategory(full)).toBe(false);
    expect(() => addCategory(full, 'Otra', 'rosa')).toThrow(SettingsError);
    const one = cats('Única');
    expect(canRemoveCategory(one)).toBe(false);
    expect(() => removeCategory(one, 'Única')).toThrow(SettingsError);
  });
});

describe('fuente de ajustes cifrada (adaptador de desarrollo)', () => {
  it(
    'sin ajustes guardados: null y revisión 0; guardar y volver a leer devuelve lo mismo',
    async () => {
      const { repo, keyring } = await devKeys();
      const source = createSettingsSource(repo, keyring);
      expect(await source.load()).toEqual({ settings: null, revision: 0 });
      const mine: Settings = {
        ...defaultSettings('en'),
        displayName: 'Ana',
        welcomeMessage: 'Hola\njardín',
        dateFormat: 'ymd',
        timeZone: 'Europe/Madrid',
        avatar: { kind: 'preset', id: 'tulipan' },
      };
      expect(await source.save(mine, 0)).toBe(1);
      expect(await source.load()).toEqual({ settings: mine, revision: 1 });
      // Lo guardado en el repositorio es un sobre opaco: ni el nombre ni el mensaje aparecen.
      const raw = await repo.vault.getSettings();
      expect(raw.payload).not.toContain('Ana');
      expect(raw.payload).not.toMatch(/jard/);
    },
    TIMEOUT,
  );

  it(
    'revisión obsoleta: `conflict`; ajustes que no validan: `invalid` y no se envía nada',
    async () => {
      const { repo, keyring } = await devKeys();
      const source = createSettingsSource(repo, keyring);
      await source.save(defaultSettings('es'), 0);
      expect(await code(source.save(defaultSettings('es'), 0))).toBe('conflict');
      const bad = { ...defaultSettings('es'), displayName: 'x'.repeat(61) };
      expect(await code(source.save(bad, 1))).toBe('invalid');
      expect((await repo.vault.getSettings()).revision).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'un sobre de OTRA revisión no se abre (AAD con la revisión): `unreadable`, nunca datos cambiados',
    async () => {
      const { repo, keyring } = await devKeys();
      const source = createSettingsSource(repo, keyring);
      await source.save({ ...defaultSettings('es'), displayName: 'Primera' }, 0); // sellado para la revisión 1
      const sealedForOne = (await repo.vault.getSettings()).payload!;
      await repo.vault.putSettings(sealedForOne, 1); // un servidor hostil lo devuelve como revisión 2
      expect(await code(source.load())).toBe('unreadable');
    },
    TIMEOUT,
  );

  it(
    'sobre manipulado: `unreadable`',
    async () => {
      const { repo, keyring } = await devKeys();
      const source = createSettingsSource(repo, keyring);
      await source.save(defaultSettings('es'), 0);
      const p = (await repo.vault.getSettings()).payload!;
      const flipped = p.slice(0, 30) + (p[30] === 'A' ? 'B' : 'A') + p.slice(31);
      await repo.vault.putSettings(flipped, 1);
      expect(await code(source.load())).toBe('unreadable');
    },
    TIMEOUT,
  );

  it(
    'claves bloqueadas: `unavailable` (no `unreadable`)',
    async () => {
      const { repo, keyring } = await devKeys();
      const source = createSettingsSource(repo, keyring);
      await source.save(defaultSettings('es'), 0);
      keyring.lock();
      expect(await code(source.load())).toBe('unavailable');
      expect(await code(source.save(defaultSettings('es'), 1))).toBe('unavailable');
    },
    TIMEOUT,
  );

  it(
    'avatar: se sube cifrado, se descifra con su id y se borra; un id ajeno da null',
    async () => {
      const { repo, keyring } = await devKeys();
      const source = createSettingsSource(repo, keyring);
      const jpeg = Uint8Array.from({ length: 2000 }, (_, i) => (i * 13) & 255);
      jpeg.set([0xff, 0xd8, 0xff]);
      const id = await source.uploadAvatar(jpeg);
      const stored = await repo.assets.getBytes(id);
      expect(stored.length).toBe(jpeg.length + 32); // sobre: 16 B de cabecera y nonce + 16 B de etiqueta
      expect(stored.slice(0, 4)).toEqual(Uint8Array.from([0x01, 0x01, 0x02, keyring.mkVersion]));
      const url = await source.avatarUrl(id);
      expect(typeof url).toBe('string');
      expect(await source.avatarUrl(id)).toBe(url); // caché
      await source.deleteAvatar(id);
      expect(await source.avatarUrl(id)).toBeNull();
      await source.deleteAvatar(id); // repetir no falla
      source.lock();
    },
    TIMEOUT,
  );

  it(
    'avatar demasiado grande: `quota` (el repositorio lo rechaza antes de guardar)',
    async () => {
      const { repo, keyring } = await devKeys();
      const source = createSettingsSource(repo, keyring);
      expect(await code(source.uploadAvatar(new Uint8Array(200 * 1024)))).toBe('quota');
    },
    TIMEOUT,
  );
});

describe('ajustes contra el servidor real (D1 y R2 simulados)', () => {
  it(
    'el servidor guarda un sobre opaco: el nombre y el mensaje no aparecen en D1',
    async () => {
      const h = makeHarness();
      const b = bridge(h);
      const keyring = await (await beginSetup(b.client, PASSWORD, FAST)).submit(SETUP_CODE);
      const source = createSettingsSource(createRemoteRepository({ fetch: b.fetch }), keyring);
      const mine = {
        ...defaultSettings('es'),
        displayName: 'NombreSecreto',
        welcomeMessage: 'MensajeSecreto',
      };
      expect(await source.save(mine, 0)).toBe(1);
      const raw = rows<{ settings_payload: string; settings_revision: number }>(
        h.raw,
        'SELECT settings_payload, settings_revision FROM vault',
      )[0]!;
      expect(raw.settings_revision).toBe(1);
      expect(raw.settings_payload).not.toMatch(/Secreto/);
      expect(atobSafe(raw.settings_payload)).not.toMatch(/Secreto/);
      expect(b.sent.join('\n')).not.toMatch(/Secreto/); // tampoco viaja en claro
      expect(await source.load()).toEqual({ settings: mine, revision: 1 });
    },
    TIMEOUT,
  );
});

function atobSafe(b64u: string): string {
  return Buffer.from(b64u.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
}

describe('cambiar la categoría de los recuerdos (renombrar o eliminar)', () => {
  it(
    'pasa a la nueva categoría solo los recuerdos de la vieja; cada uno conserva su flor y sus fotos',
    async () => {
      const { garden } = await createDevSpace();
      const before = await garden.list();
      const from = before[0]!.category;
      const affected = before.filter((m) => m.category === from);
      const others = before.filter((m) => m.category !== from);
      const seen: number[] = [];
      const moved = await moveCategory(garden, from, 'Renombrada', (p) => seen.push(p.done));
      expect(moved).toBe(affected.length);
      expect(seen).toEqual(Array.from({ length: affected.length + 1 }, (_, i) => i));
      const after = new Map((await garden.list()).map((m) => [m.id, m]));
      for (const m of affected) {
        const now = after.get(m.id)!;
        expect(now.category).toBe('Renombrada');
        expect(now.flower).toBe(m.flower);
        expect(now.title).toBe(m.title);
        expect(now.date).toBe(m.date);
      }
      for (const m of others) expect(after.get(m.id)!.category).toBe(m.category);
      expect(await moveCategory(garden, from, 'Otra')).toBe(0); // ya no queda ninguno
    },
    TIMEOUT,
  );

  it('si falla a mitad, dice cuántos se cambiaron; repetir termina los que faltan', async () => {
    const memories: GardenMemory[] = ['a', 'b', 'c'].map((id) => ({
      id,
      updatedAt: 1,
      title: id,
      date: '2026-10-01',
      category: 'Vieja',
      text: '',
      link: null,
      flower: 'rosa',
      season: 'otono',
      photos: [],
    }));
    let failOn: string | null = 'b';
    const fake = {
      list: async () => memories.map((m) => ({ ...m })),
      update: async (id: string, input: SaveMemoryInput) => {
        if (id === failOn) throw new Error('red');
        const i = memories.findIndex((m) => m.id === id);
        memories[i] = { ...memories[i]!, ...input.fields };
        return { memory: memories[i]!, failedPhotos: [] };
      },
    } as unknown as GardenSource;

    let failure: unknown;
    try {
      await moveCategory(fake, 'Vieja', 'Nueva');
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(MoveError);
    expect((failure as MoveError).done).toBe(1);
    expect((failure as MoveError).total).toBe(3);
    failOn = null;
    expect(await moveCategory(fake, 'Vieja', 'Nueva')).toBe(2);
    expect(memories.map((m) => m.category)).toEqual(['Nueva', 'Nueva', 'Nueva']);
  });
});
