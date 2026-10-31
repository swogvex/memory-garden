import { describe, expect, it } from 'vitest';
import { saveFailureOf, type GardenSource, type MemoryFields } from '@/features/calendar';
import { beginSetup, readStatus, unlock } from '@/features/access/access-flow';
import { createGardenSource } from '@/features/access/garden-source';
import { currentSource, installSource, lockSession, onLock } from '@/features/access/session';
import { buildSeedPayloads } from '@/dev/seed-data';
import { createRemoteRepository } from '@/lib/remote/remote-repository';
import { SETUP_CODE, makeHarness, type Harness } from './server/_support';
import { FAST, bridge, type Bridge } from './_access-helpers';

/**
 * La fuente de datos de producción (claves reales + repositorio remoto) contra el Worker real con D1 y R2 simulados.
 * Dos «dispositivos» entran en el mismo espacio con su propia sesión.
 */
const PASSWORD = 'correcto caballo bateria grapa 2026';
const TIMEOUT = 120_000;

const { photos: _ignored, ...FIELDS } = buildSeedPayloads()[0]!;
void _ignored;
const fields = (title: string): MemoryFields => ({ ...FIELDS, title });
const jpeg = (n: number, seed: number) =>
  Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255);

async function openDevice(h: Harness, first = false): Promise<{ source: GardenSource; b: Bridge }> {
  const b = bridge(h);
  const repo = createRemoteRepository({ fetch: b.fetch });
  if (first) {
    const pending = await beginSetup(b.client, PASSWORD, FAST);
    return { source: createGardenSource(repo, await pending.submit(SETUP_CODE)), b };
  }
  const status = await readStatus(b.client);
  if (!status.configured) throw new Error('espacio sin crear');
  return {
    source: createGardenSource(repo, (await unlock(b.client, status, PASSWORD, FAST)).keyring),
    b,
  };
}

describe('fuente de datos remota', () => {
  it(
    'crea, lista, edita y manda a la papelera; el servidor solo guarda texto cifrado',
    async () => {
      const h = makeHarness();
      const { source } = await openDevice(h, true);
      const created = await source.create({
        fields: fields('Un recuerdo secreto'),
        photos: [{ photo: jpeg(3000, 1), thumb: jpeg(500, 2), alt: 'una foto' }],
      });
      expect(created.failedPhotos).toEqual([]);
      expect(created.memory.photos).toHaveLength(1);

      const listed = await source.list();
      expect(listed.map((m) => m.title)).toEqual(['Un recuerdo secreto']);

      const kept = created.memory.photos[0]!;
      const edited = await source.update(created.memory.id, {
        fields: fields('Título cambiado'),
        photos: [{ kind: 'kept', ...kept }],
      });
      expect(edited.memory.title).toBe('Título cambiado');
      expect((await source.list())[0]?.title).toBe('Título cambiado');

      const dump = JSON.stringify([
        h.raw.prepare('SELECT * FROM memory').all(),
        h.raw.prepare('SELECT * FROM asset').all(),
      ]);
      expect(dump).not.toContain('Un recuerdo secreto');
      expect(dump).not.toContain('Título cambiado');

      await source.trash(created.memory.id);
      expect(await source.list()).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'la foto vuelve descifrada y solo con las claves; al bloquear, deja de estar disponible',
    async () => {
      const h = makeHarness();
      const { source } = await openDevice(h, true);
      const { memory } = await source.create({
        fields: fields('Con foto'),
        photos: [{ photo: jpeg(3000, 3), thumb: jpeg(500, 4), alt: 'a' }],
      });
      const url = await source.imageUrl(memory, 0, 'photo');
      expect(url).toMatch(/^blob:/);
      const blob = await (await fetch(url!)).blob();
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(jpeg(3000, 3));
      source.lock();
      expect(await source.imageUrl(memory, 1, 'photo')).toBeNull();
      expect(await source.imageUrl(memory, 0, 'thumb')).toBeNull(); // sin claves no se descifra nada
    },
    TIMEOUT,
  );

  it(
    'dos dispositivos ven lo mismo; si editan a la vez, prevalece el último en guardar y no se pierde el recuerdo',
    async () => {
      const h = makeHarness();
      const a = await openDevice(h, true);
      const created = await a.source.create({ fields: fields('Original'), photos: [] });
      const b = await openDevice(h);
      expect((await b.source.list()).map((m) => m.title)).toEqual(['Original']);

      const fromA = await a.source.update(created.memory.id, {
        fields: fields('Desde A'),
        photos: [],
      });
      expect(fromA.replacedRemote).toBe(false);
      h.clock.now += 5;
      // B tenía la revisión vieja: se guarda encima y lo dice (H8.4, aviso `replaced_remote` de D-188).
      const fromB = await b.source.update(created.memory.id, {
        fields: fields('Desde B'),
        photos: [],
      });
      expect(fromB.replacedRemote).toBe(true);
      expect((await a.source.list()).map((m) => m.title)).toEqual(['Desde B']);
    },
    TIMEOUT,
  );

  it(
    'si el recuerdo se mandó a la papelera en otro dispositivo, no se resucita al guardar',
    async () => {
      const h = makeHarness();
      const a = await openDevice(h, true);
      const created = await a.source.create({ fields: fields('Original'), photos: [] });
      const b = await openDevice(h);
      await b.source.list();
      await a.source.trash(created.memory.id);
      let error: unknown = null;
      try {
        await b.source.update(created.memory.id, { fields: fields('Editado tarde'), photos: [] });
      } catch (e) {
        error = e;
      }
      expect((error as Error).message).toBe('garden:save_failed');
      expect(saveFailureOf(error)).toBe('remote_changed'); // la pantalla explica qué ha pasado (H8.4)
      expect(await a.source.list()).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'una foto que no se puede subir no impide guardar el recuerdo (queda sin ella)',
    async () => {
      const h = makeHarness();
      const { source } = await openDevice(h, true);
      const tooBig = jpeg(2 * 1024 * 1024 + 1, 9); // por encima del tope de una foto
      const result = await source.create({
        fields: fields('Foto enorme'),
        photos: [{ photo: tooBig, thumb: jpeg(500, 1), alt: 'x' }],
      });
      expect(result.failedPhotos).toEqual([0]);
      expect(result.memory.photos).toEqual([]);
    },
    TIMEOUT,
  );
});

describe('sesión de esta pestaña', () => {
  it(
    'instalar la fuente la deja disponible; bloquear la suelta y avisa; una sesión caducada (401) bloquea sola',
    async () => {
      const h = makeHarness();
      const { b } = await openDevice(h, true);
      const status = await readStatus(b.client);
      if (!status.configured) throw new Error('x');
      const { keyring } = await unlock(bridge(h).client, status, PASSWORD, FAST);
      const reasons: string[] = [];
      const off = onLock((r) => reasons.push(r));

      const repo = createRemoteRepository({
        fetch: (() =>
          Promise.resolve(
            new Response('{"error":"unauthorized"}', { status: 401 }),
          )) as typeof fetch,
        onUnauthorized: () => lockSession('expired'),
      });
      const source = installSource(keyring, repo);
      expect(currentSource()).toBe(source);
      let failed = false;
      try {
        await source.list();
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      expect(reasons).toEqual(['expired']);
      expect(currentSource()).toBeNull();

      lockSession('manual'); // ya bloqueada: no avisa dos veces
      expect(reasons).toEqual(['expired']);
      off();
    },
    TIMEOUT,
  );
});
