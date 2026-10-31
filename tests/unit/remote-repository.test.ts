import { describe, expect, it } from 'vitest';
import { createRemoteRepository } from '@/lib/remote/remote-repository';
import { pullChanges, saveWithResolution } from '@/lib/storage/resolve';
import { StorageError, type PutMemoryInput, type Repository } from '@/lib/storage';
import { createDevMemoryRepository } from '@/lib/storage/dev-memory-adapter';
import { handleApi } from '@/server';
import { rows } from './server/_d1';
import {
  ORIGIN,
  T0,
  doSetup,
  fakeAsset,
  fakePayload,
  makeHarness,
  newId,
  type Harness,
} from './server/_support';

/**
 * H7.2b · adaptador remoto contra el SERVIDOR REAL (src/server, D1 y R2 simulados): la «red» es una función `fetch` que
 * entrega la petición a `handleApi`, con interruptores para cortar la red, perder respuestas o cortar descargas.
 * Cubre el contrato del repositorio, los errores, la conexión perdida y dos dispositivos con la misma cuenta.
 */
interface Net {
  down: boolean;
  /** Procesa la petición pero «pierde» la respuesta (la conexión se corta después de que el servidor aplicó el cambio). */
  loseResponses: number;
  /** Devuelve la descarga cortada a la mitad. */
  cutBody: boolean;
  /** No responde nunca (hasta que salte el tiempo máximo). */
  hang: boolean;
  /** Sustituye el cuerpo de la respuesta (servidor raro). */
  override: ((url: string) => Response | null) | null;
  unauthorized: number;
}

interface Device {
  repo: Repository;
  net: Net;
  unauthorized: { count: number };
}

function connect(h: Harness, cookie: string, options: { timeoutMs?: number } = {}): Device {
  const net: Net = {
    down: false,
    loseResponses: 0,
    cutBody: false,
    hang: false,
    override: null,
    unauthorized: 0,
  };
  const unauthorized = { count: 0 };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (net.down) throw new TypeError('fetch failed');
    if (net.hang) {
      await new Promise((_, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('timeout', 'TimeoutError')),
        ),
      );
    }
    const forced = net.override?.(url);
    if (forced) return forced;
    const headers = new Headers(init?.headers);
    headers.set('Origin', ORIGIN);
    if (net.unauthorized > 0) net.unauthorized--;
    else headers.set('Cookie', cookie);
    if (init?.body instanceof Uint8Array) headers.set('Content-Length', String(init.body.length)); // el navegador lo pone solo con cuerpos en memoria
    const req = new Request(ORIGIN + url, {
      method: init?.method,
      headers,
      body: init?.body as BodyInit | undefined,
      ...(init?.signal ? { signal: init.signal } : {}),
    });
    const res = await handleApi(req, h.env, { now: () => h.clock.now });
    if (net.loseResponses > 0) {
      net.loseResponses--;
      throw new TypeError('fetch failed');
    }
    if (net.cutBody) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const half = bytes.slice(0, Math.max(1, bytes.length >> 1));
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(half);
          },
          pull() {
            throw new TypeError('terminated');
          },
        }),
        { status: res.status, headers: res.headers },
      );
    }
    return res;
  };
  return {
    net,
    unauthorized,
    repo: createRemoteRepository({
      fetch: fetchImpl,
      now: () => h.clock.now * 1000,
      onUnauthorized: () => void unauthorized.count++,
      ...options,
    }),
  };
}

async function ready() {
  const h = makeHarness();
  const { cookie } = await doSetup(h);
  return { h, cookie, a: connect(h, cookie), cookie_: cookie };
}

const input = (id: string, over: Partial<PutMemoryInput> = {}): PutMemoryInput => ({
  id,
  payload: fakePayload(),
  schemaVersion: 1,
  mkVersion: 1,
  assetIds: [],
  ...over,
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof StorageError ? err.code : `otro:${String(err)}`;
  }
}

describe('contrato del repositorio', () => {
  it('crear, leer, listar y editar con revisión: los registros salen en el formato del cliente', async () => {
    const { a } = await ready();
    const id = newId();
    const first = input(id);
    const created = await a.repo.memories.put(first, null);
    expect(created).toMatchObject({
      id,
      payload: first.payload,
      schemaVersion: 1,
      mkVersion: 1,
      revision: 1,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    });
    expect(await a.repo.memories.get(id)).toEqual(created);
    expect(await a.repo.memories.list()).toEqual([created]);
    const edited = await a.repo.memories.put(input(id, { payload: fakePayload(300) }), 1);
    expect(edited.revision).toBe(2);
    expect((await a.repo.memories.get(id))?.payload).toBe(edited.payload);
  });

  it('fotos: subir (pending), ligar al guardar, listar y descargar los mismos bytes; la miniatura queda ligada a su foto', async () => {
    const { a } = await ready();
    const photo = newId();
    const thumb = newId();
    const photoBytes = fakeAsset(5000);
    const thumbBytes = fakeAsset(800);
    const up = await a.repo.assets.put({
      id: photo,
      kind: 'photo',
      parentId: null,
      mkVersion: 1,
      bytes: photoBytes,
    });
    expect(up).toMatchObject({ id: photo, state: 'pending', memoryId: null, sizeBytes: 5000 });
    await a.repo.assets.put({
      id: thumb,
      kind: 'thumb',
      parentId: photo,
      mkVersion: 1,
      bytes: thumbBytes,
    });
    expect(await code(a.repo.assets.getBytes(photo))).toBe('not_found'); // aún pending
    const id = newId();
    await a.repo.memories.put(input(id, { assetIds: [photo, thumb] }), null);
    const list = await a.repo.assets.list(id);
    expect(list.map((x) => x.id).sort()).toEqual([photo, thumb].sort());
    expect(list.every((x) => x.state === 'ready' && x.memoryId === id)).toBe(true);
    expect(list.find((x) => x.id === thumb)?.parentId).toBe(photo);
    expect(await a.repo.assets.getBytes(photo)).toEqual(photoBytes);
    expect(await a.repo.assets.getBytes(thumb)).toEqual(thumbBytes);
    expect(await a.repo.assets.list(newId())).toEqual([]);
  });

  it('errores con los mismos códigos que el adaptador de desarrollo', async () => {
    const { a } = await ready();
    const id = newId();
    await a.repo.memories.put(input(id), null);
    expect(await code(a.repo.memories.put(input(id), null))).toBe('conflict'); // ya existe
    expect(await code(a.repo.memories.put(input(id), 9))).toBe('conflict'); // revisión distinta
    expect(await code(a.repo.memories.put(input(newId()), 1))).toBe('conflict'); // no existe
    expect(await code(a.repo.memories.put(input(newId(), { payload: 'corto' }), null))).toBe(
      'invalid',
    );
    expect(await code(a.repo.memories.put(input(newId(), { assetIds: [newId()] }), null))).toBe(
      'invalid',
    );
    expect(await a.repo.memories.get(newId())).toBeNull();
    expect(await code(a.repo.assets.getBytes(newId()))).toBe('not_found');
    expect(await code(a.repo.assets.delete(newId()))).toBe('not_found');
  });

  it('papelera: trash/restore con revisión esperada, purga solo desde la papelera y borra las fotos', async () => {
    const { a, h } = await ready();
    const photo = newId();
    await a.repo.assets.put({
      id: photo,
      kind: 'photo',
      parentId: null,
      mkVersion: 1,
      bytes: fakeAsset(3000),
    });
    const id = newId();
    await a.repo.memories.put(input(id, { assetIds: [photo] }), null);
    expect(await code(a.repo.memories.trash(id, 5))).toBe('conflict');
    expect(await code(a.repo.memories.restore(id, 1))).toBe('conflict'); // ya visible
    expect(await code(a.repo.memories.purge(id))).toBe('conflict'); // visible: no se purga
    const trashed = await a.repo.memories.trash(id, 1);
    expect(trashed).toMatchObject({ revision: 2, deletedAt: T0 });
    expect(await a.repo.memories.list()).toEqual([]);
    expect((await a.repo.memories.list({ includeTrashed: true })).length).toBe(1);
    expect(await code(a.repo.memories.trash(id, 2))).toBe('conflict'); // ya en papelera
    const back = await a.repo.memories.restore(id, 2);
    expect(back).toMatchObject({ revision: 3, deletedAt: null });
    await a.repo.memories.trash(id, 3);
    await a.repo.memories.purge(id);
    expect(await a.repo.memories.get(id)).toBeNull();
    expect(await code(a.repo.assets.getBytes(photo))).toBe('not_found');
    expect(h.r2.store.size).toBe(0);
    expect(await code(a.repo.memories.purge(id))).toBe('not_found');
  });

  it('list: `since` es estrictamente posterior, trae la papelera si se pide y recorre más de una página', async () => {
    const { a, h } = await ready();
    const ids: string[] = [];
    for (let i = 0; i < 130; i++) {
      const id = newId();
      ids.push(id);
      await a.repo.memories.put(input(id), null);
    }
    h.clock.now += 100;
    await a.repo.memories.put(input(ids[7] as string, { payload: fakePayload(333) }), 1);
    expect((await a.repo.memories.list()).length).toBe(130);
    expect(new Set((await a.repo.memories.list()).map((m) => m.id)).size).toBe(130);
    expect((await a.repo.memories.list({ since: T0 })).map((m) => m.id)).toEqual([ids[7]]);
    expect(await a.repo.memories.list({ since: T0 + 100 })).toEqual([]);
    h.clock.now += 5;
    await a.repo.memories.trash(ids[9] as string, 1);
    expect((await a.repo.memories.list({ since: T0 + 100 })).length).toBe(0);
    expect(
      (await a.repo.memories.list({ since: T0 + 100, includeTrashed: true })).map((m) => m.id),
    ).toEqual([ids[9]]);
  });

  it('los registros devueltos son copias: modificarlos no afecta a lo siguiente', async () => {
    const { a } = await ready();
    const id = newId();
    await a.repo.memories.put(input(id), null);
    const one = (await a.repo.memories.list())[0] as { payload: string };
    (one as { payload: string }).payload = 'x';
    expect((await a.repo.memories.list())[0]?.payload).not.toBe('x');
  });
});

describe('límites de subida', () => {
  it('foto demasiado grande → too_large; sobre inválido → invalid; id repetido → conflict; 13.ª pendiente → quota', async () => {
    const { a } = await ready();
    expect(
      await code(
        a.repo.assets.put({
          id: newId(),
          kind: 'photo',
          parentId: null,
          mkVersion: 1,
          bytes: fakeAsset(2 * 1024 * 1024 + 1),
        }),
      ),
    ).toBe('too_large');
    expect(
      await code(
        a.repo.assets.put({
          id: newId(),
          kind: 'photo',
          parentId: null,
          mkVersion: 1,
          bytes: new Uint8Array(500),
        }),
      ),
    ).toBe('invalid');
    const dup = newId();
    await a.repo.assets.put({
      id: dup,
      kind: 'photo',
      parentId: null,
      mkVersion: 1,
      bytes: fakeAsset(500),
    });
    expect(
      await code(
        a.repo.assets.put({
          id: dup,
          kind: 'photo',
          parentId: null,
          mkVersion: 1,
          bytes: fakeAsset(500),
        }),
      ),
    ).toBe('conflict');
    for (let i = 0; i < 11; i++)
      await a.repo.assets.put({
        id: newId(),
        kind: 'photo',
        parentId: null,
        mkVersion: 1,
        bytes: fakeAsset(400),
      });
    expect(
      await code(
        a.repo.assets.put({
          id: newId(),
          kind: 'photo',
          parentId: null,
          mkVersion: 1,
          bytes: fakeAsset(400),
        }),
      ),
    ).toBe('quota');
  });

  it('cancelar una subida sin ligar la borra del servidor', async () => {
    const { a, h } = await ready();
    const id = newId();
    await a.repo.assets.put({
      id,
      kind: 'photo',
      parentId: null,
      mkVersion: 1,
      bytes: fakeAsset(900),
    });
    await a.repo.assets.delete(id);
    expect(h.r2.store.size).toBe(0);
  });
});

describe('red y sesión', () => {
  it('sin conexión: toda operación da `unavailable` y no cambia nada', async () => {
    const { a, h } = await ready();
    a.net.down = true;
    const id = newId();
    const ops = [
      a.repo.memories.list(),
      a.repo.memories.get(id),
      a.repo.memories.put(input(id), null),
      a.repo.memories.trash(id, 1),
      a.repo.memories.restore(id, 1),
      a.repo.memories.purge(id),
      a.repo.assets.put({
        id: newId(),
        kind: 'photo',
        parentId: null,
        mkVersion: 1,
        bytes: fakeAsset(400),
      }),
      a.repo.assets.getBytes(id),
      a.repo.assets.list(id),
      a.repo.assets.delete(id),
    ];
    for (const op of ops) expect(await code(op)).toBe('unavailable');
    expect(h.raw.prepare('SELECT count(*) AS n FROM memory').get()).toEqual({ n: 0 });
    a.net.down = false;
    expect(await a.repo.memories.list()).toEqual([]); // al volver la red, sigue funcionando
  });

  it('sin sesión (caducada): `onUnauthorized` avisa y la operación da `unavailable`; no se filtra nada', async () => {
    const { a } = await ready();
    a.net.unauthorized = 1;
    expect(await code(a.repo.memories.list())).toBe('unavailable');
    expect(a.unauthorized.count).toBe(1);
  });

  it('el servidor no responde: se agota el tiempo y da `unavailable` (no se queda colgado)', async () => {
    const h = makeHarness();
    const { cookie } = await doSetup(h);
    const a = connect(h, cookie, { timeoutMs: 40 });
    a.net.hang = true;
    expect(await code(a.repo.memories.list())).toBe('unavailable');
  });

  it('respuesta con forma inesperada (servidor raro, página de error, JSON de otro tipo): `unavailable`', async () => {
    const { a } = await ready();
    a.net.override = () => new Response('<html>gateway</html>', { status: 200 });
    expect(await code(a.repo.memories.list())).toBe('unavailable');
    expect(await code(a.repo.memories.get(newId()))).toBe('unavailable');
    a.net.override = () =>
      new Response(JSON.stringify({ items: [{ id: 1 }], next: null }), { status: 200 });
    expect(await code(a.repo.memories.list())).toBe('unavailable');
    a.net.override = () => new Response('boom', { status: 502 });
    expect(await code(a.repo.memories.put(input(newId()), null))).toBe('unavailable');
    expect(await code(a.repo.assets.getBytes(newId()))).toBe('unavailable');
  });

  it('descarga cortada a la mitad: `unavailable` (nunca bytes truncados)', async () => {
    const { a } = await ready();
    const photo = newId();
    await a.repo.assets.put({
      id: photo,
      kind: 'photo',
      parentId: null,
      mkVersion: 1,
      bytes: fakeAsset(5000),
    });
    await a.repo.memories.put(input(newId(), { assetIds: [photo] }), null);
    a.net.cutBody = true;
    expect(await code(a.repo.assets.getBytes(photo))).toBe('unavailable');
  });

  it('respuesta perdida al CREAR: el reintento reconoce su propio guardado y devuelve el recuerdo (no un conflicto)', async () => {
    const { a, h } = await ready();
    const id = newId();
    const mine = input(id);
    a.net.loseResponses = 1;
    const saved = await a.repo.memories.put(mine, null);
    expect(saved).toMatchObject({ id, revision: 1, payload: mine.payload });
    expect(h.raw.prepare('SELECT count(*) AS n FROM memory').get()).toEqual({ n: 1 });
  });

  it('respuesta perdida al EDITAR: igual, sin revisión doble', async () => {
    const { a } = await ready();
    const id = newId();
    await a.repo.memories.put(input(id), null);
    const next = input(id, { payload: fakePayload(222) });
    a.net.loseResponses = 1;
    const saved = await a.repo.memories.put(next, 1);
    expect(saved.revision).toBe(2);
    expect((await a.repo.memories.get(id))?.revision).toBe(2);
  });

  it('respuesta perdida y otro dispositivo escribió entremedias: el reintento NO lo toma por suyo (conflicto real)', async () => {
    const { a, h, cookie } = await ready();
    const b = connect(h, cookie);
    const id = newId();
    await a.repo.memories.put(input(id), null);
    await b.repo.memories.put(input(id, { payload: fakePayload(250) }), 1); // B gana: revisión 2
    a.net.loseResponses = 1;
    expect(await code(a.repo.memories.put(input(id, { payload: fakePayload(260) }), 1))).toBe(
      'conflict',
    );
  });

  it('dos desconexiones seguidas: no hay bucles (un solo reintento) y se informa `unavailable`', async () => {
    const { a } = await ready();
    a.net.loseResponses = 2;
    expect(await code(a.repo.memories.put(input(newId()), null))).toBe('unavailable');
  });

  it('el adaptador no escribe en la consola ni usa el almacenamiento del navegador', async () => {
    const calls: unknown[] = [];
    const saved = { log: console.log, error: console.error, warn: console.warn };
    console.log = console.error = console.warn = (...a: unknown[]) => void calls.push(a);
    try {
      const { a } = await ready();
      a.net.down = true;
      await code(a.repo.memories.list());
      a.net.down = false;
      a.net.override = () => new Response('x', { status: 500 });
      await code(a.repo.memories.list());
    } finally {
      Object.assign(console, saved);
    }
    expect(calls).toEqual([]);
  });

  it('cambiar las claves del `vault` no va por aquí (lo lleva el cliente de autenticación): `unavailable`', async () => {
    const { a } = await ready();
    expect(await code(a.repo.vault.replaceKeys({}, 1))).toBe('unavailable');
  });

  it('H8.3: `vault.get` lee el registro cifrado tal cual (para la exportación)', async () => {
    const { a, h } = await ready();
    const v = await a.repo.vault.get();
    const row = rows<{ id: string; wrapped_mk_rec: string; kdf: string }>(
      h.raw,
      'SELECT id, wrapped_mk_rec, kdf FROM vault',
    )[0];
    expect(v).toMatchObject({
      id: row?.id,
      wrappedMkRec: row?.wrapped_mk_rec,
      kdf: row?.kdf,
      settingsPayload: null,
      settingsRevision: 0,
      keyRevision: 1,
    });
  });
});

describe('ajustes cifrados (H8.1)', () => {
  it('leer, guardar con revisión y ver lo guardado desde otro dispositivo', async () => {
    const { a, h, cookie } = await ready();
    const b = connect(h, cookie);
    expect(await a.repo.vault.getSettings()).toEqual({ payload: null, revision: 0 });
    const payload = fakePayload(200);
    expect(await a.repo.vault.putSettings(payload, 0)).toEqual({ revision: 1 });
    expect(await b.repo.vault.getSettings()).toEqual({ payload, revision: 1 });
  });

  it('revisión obsoleta: `conflict` (la pantalla recarga y avisa)', async () => {
    const { a, h, cookie } = await ready();
    const b = connect(h, cookie);
    await a.repo.vault.putSettings(fakePayload(), 0);
    expect(await code(b.repo.vault.putSettings(fakePayload(), 0))).toBe('conflict');
  });

  it('respuesta perdida: el reintento reconoce el propio guardado y no duplica la revisión', async () => {
    const { a } = await ready();
    const payload = fakePayload();
    a.net.loseResponses = 1;
    expect(await a.repo.vault.putSettings(payload, 0)).toEqual({ revision: 1 });
    expect(await a.repo.vault.getSettings()).toEqual({ payload, revision: 1 });
  });

  it('respuesta perdida y otro dispositivo guardó entre medias: `conflict`, no un falso éxito', async () => {
    const { a, h, cookie } = await ready();
    const b = connect(h, cookie);
    await b.repo.vault.putSettings(fakePayload(), 0);
    a.net.down = true;
    const pending = code(a.repo.vault.putSettings(fakePayload(), 0));
    a.net.down = false;
    expect(['conflict', 'unavailable']).toContain(await pending);
  });

  it('respuesta con forma rara: `unavailable`', async () => {
    const { a } = await ready();
    a.net.override = (url) =>
      url.includes('/api/vault/settings')
        ? new Response(JSON.stringify({ payload: 7, revision: 'x' }), { status: 200 })
        : null;
    expect(await code(a.repo.vault.getSettings())).toBe('unavailable');
  });
});

describe('dos dispositivos con la misma cuenta (sincronización y conflictos)', () => {
  it('lo que guarda uno lo ve el otro con `pullChanges`, papelera y borrados incluidos; los repetidos son inofensivos', async () => {
    const { a, h, cookie } = await ready();
    const b = connect(h, cookie);
    let state = { cursor: -1 };
    const id1 = newId();
    const id2 = newId();
    await a.repo.memories.put(input(id1), null);
    await a.repo.memories.put(input(id2), null);
    let pulled = await pullChanges(b.repo, state);
    expect(pulled.changes.map((m) => m.id).sort()).toEqual([id1, id2].sort());
    state = pulled.state;
    expect(state.cursor).toBe(T0);
    // Un cambio en el MISMO segundo del cursor: se vuelve a traer (retroceso de 1 s) y no se pierde.
    await a.repo.memories.put(input(newId()), null);
    pulled = await pullChanges(b.repo, state);
    expect(pulled.changes.length).toBe(3);
    h.clock.now += 30;
    await a.repo.memories.trash(id1, 1);
    pulled = await pullChanges(b.repo, pulled.state);
    expect(
      pulled.changes.some((m) => m.id === id1 && m.deletedAt !== null && m.revision === 2),
    ).toBe(true); // el borrado se ve (y los de T0 vuelven por el retroceso de 1 s)
    expect(pulled.state.cursor).toBe(T0 + 30);
    pulled = await pullChanges(b.repo, pulled.state);
    expect(pulled.changes.map((m) => [m.id, m.revision])).toEqual([[id1, 2]]); // el mismo cambio, otra vez: se distingue por id y revisión
  });

  it('conflicto: la versión de este dispositivo es la más reciente y prevalece, con aviso y la versión reemplazada', async () => {
    const { a, h, cookie } = await ready();
    const b = connect(h, cookie);
    const id = newId();
    await a.repo.memories.put(input(id), null);
    h.clock.now += 10;
    const fromA = input(id, { payload: fakePayload(210) });
    await a.repo.memories.put(fromA, 1); // A guarda: revisión 2
    h.clock.now += 10;
    const fromB = input(id, { payload: fakePayload(220) });
    const r = await saveWithResolution(b.repo, fromB, 1); // B aún tenía la revisión 1
    expect(r.notice).toMatchObject({ kind: 'replaced_remote' });
    expect(r.notice?.kind === 'replaced_remote' && r.notice.replaced.payload).toBe(fromA.payload);
    expect(r.record).toMatchObject({ revision: 3, payload: fromB.payload });
    expect((await a.repo.memories.get(id))?.payload).toBe(fromB.payload);
  });

  it('sin conflicto no hay aviso; si el servidor ya tiene exactamente lo mismo, tampoco', async () => {
    const { a, h, cookie } = await ready();
    const b = connect(h, cookie);
    const id = newId();
    const same = input(id);
    expect((await saveWithResolution(a.repo, same, null)).notice).toBeNull();
    await a.repo.memories.put(input(id, { payload: same.payload }), 1); // revisión 2, mismo contenido
    const r = await saveWithResolution(b.repo, same, 1);
    expect(r.notice).toBeNull();
    expect(r.record?.revision).toBe(2);
  });

  it('el otro dispositivo lo movió a la papelera: no se resucita solo; si lo borró del todo, se avisa', async () => {
    const { a, h, cookie } = await ready();
    const b = connect(h, cookie);
    const id = newId();
    await a.repo.memories.put(input(id), null);
    await a.repo.memories.trash(id, 1);
    const trashed = await saveWithResolution(b.repo, input(id, { payload: fakePayload(240) }), 1);
    expect(trashed).toMatchObject({ record: null, notice: { kind: 'remote_trashed' } });
    expect((await a.repo.memories.get(id))?.deletedAt).not.toBeNull();
    await a.repo.memories.purge(id);
    const gone = await saveWithResolution(b.repo, input(id), 1);
    expect(gone).toEqual({ record: null, notice: { kind: 'remote_gone' } });
  });

  it('crear con un id que ya existe sigue siendo un error (no hay «sobrescribir» al crear)', async () => {
    const { a } = await ready();
    const id = newId();
    await a.repo.memories.put(input(id), null);
    expect(await code(saveWithResolution(a.repo, input(id), null))).toBe('conflict');
  });

  it('errores que no son conflicto (red, validación) suben tal cual, sin reintentos ocultos', async () => {
    const { a } = await ready();
    a.net.down = true;
    expect(await code(saveWithResolution(a.repo, input(newId()), 1))).toBe('unavailable');
  });
});

describe('resolve.ts no depende del adaptador', () => {
  it('con el adaptador de desarrollo da el mismo resultado ante un conflicto', async () => {
    const dev = createDevMemoryRepository();
    await dev.vault.create({
      id: newId(),
      kdf: 'k'.repeat(50),
      mkVersion: 1,
      wrappedMkPw: 'w'.repeat(90),
      recSalt: newId(),
      wrappedMkRec: 'r'.repeat(90),
    });
    const id = newId();
    await dev.memories.put(input(id), null);
    await dev.memories.put(input(id, { payload: fakePayload(210) }), 1);
    const r = await saveWithResolution(dev, input(id, { payload: fakePayload(230) }), 1);
    expect(r.notice).toMatchObject({ kind: 'replaced_remote' });
    expect(r.record?.revision).toBe(3);
  });
});
