// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDevMemoryRepository } from '../../src/lib/storage/dev-memory-adapter';
import { StorageError } from '../../src/lib/storage/errors';
import { MAX_ASSET_BYTES, MAX_PENDING_ASSETS } from '../../src/lib/storage/limits';
import type { Repository } from '../../src/lib/storage/types';
import { b64uEncode } from '../../src/lib/crypto/bytes';
import { newId } from '../../src/lib/crypto/ids';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof StorageError) return e.code;
    throw e;
  }
  return 'none';
}
const wire = (n = 90): string => 'A'.repeat(n);
const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(7);
const mem = (id: string, assetIds: string[] = []) => ({
  id,
  payload: wire(),
  schemaVersion: 1,
  mkVersion: 1,
  assetIds,
});
const KDF = `{"v":1,"alg":"pbkdf2-sha256","iter":1000000,"salt":"${b64uEncode(new Uint8Array(16))}"}`;
const newVault = () => ({
  id: newId(),
  kdf: KDF,
  mkVersion: 1,
  wrappedMkPw: wire(),
  recSalt: newId(),
  wrappedMkRec: wire(),
});

async function ready(): Promise<Repository> {
  const r = createDevMemoryRepository();
  await r.vault.create(newVault());
  return r;
}

describe('repositorio en memoria (SOLO desarrollo): vault y ajustes', () => {
  it('cuenta única: un segundo espacio es conflicto; sin espacio, todo es not_found', async () => {
    const r = createDevMemoryRepository();
    expect(await r.vault.get()).toBeNull();
    expect(await code(r.memories.put(mem(newId()), null))).toBe('not_found');
    await r.vault.create(newVault());
    expect(await code(r.vault.create(newVault()))).toBe('conflict');
  });

  it('replaceKeys: pares obligatorios, concurrencia por keyRevision y rechazo de formas inválidas', async () => {
    const r = await ready();
    const v = (await r.vault.get())!;
    expect(v.keyRevision).toBe(1);
    expect(await code(r.vault.replaceKeys({}, 1))).toBe('invalid');
    expect(await code(r.vault.replaceKeys({ kdf: KDF }, 1))).toBe('invalid'); // falta wrappedMkPw
    expect(await code(r.vault.replaceKeys({ recSalt: newId() }, 1))).toBe('invalid');
    expect(await code(r.vault.replaceKeys({ kdf: KDF, wrappedMkPw: wire() }, 7))).toBe('conflict');
    const v2 = await r.vault.replaceKeys({ kdf: KDF, wrappedMkPw: wire(100) }, 1);
    expect(v2.keyRevision).toBe(2);
    expect(v2.wrappedMkPw).toBe(wire(100));
    expect(v2.wrappedMkRec).toBe(v.wrappedMkRec); // lo no tocado se conserva
    expect(await code(r.vault.replaceKeys({ kdf: KDF, wrappedMkPw: wire() }, 1))).toBe('conflict'); // otro dispositivo llegó antes
    expect(await code(r.vault.replaceKeys({ recSalt: 'corto', wrappedMkRec: wire() }, 2))).toBe(
      'invalid',
    );
    expect(
      (await r.vault.replaceKeys({ recSalt: newId(), wrappedMkRec: wire(70) }, 2)).keyRevision,
    ).toBe(3);
  });

  it('ajustes: la revisión nueva es expected+1 y un cambio concurrente es conflicto', async () => {
    const r = await ready();
    expect(await r.vault.getSettings()).toEqual({ payload: null, revision: 0 });
    expect((await r.vault.putSettings(wire(), 0)).revision).toBe(1);
    expect(await code(r.vault.putSettings(wire(), 0))).toBe('conflict');
    expect((await r.vault.putSettings(wire(), 1)).revision).toBe(2);
    expect(await code(r.vault.putSettings('no es base64url!', 2))).toBe('invalid');
  });
});

describe('repositorio en memoria: recuerdos', () => {
  it('crear, actualizar con control de revisión, listar con since y papelera/restaurar/purgar', async () => {
    let t = 1_000_000;
    const r = createDevMemoryRepository({ now: () => t });
    await r.vault.create(newVault());
    const id = newId();
    const a = await r.memories.put(mem(id), null);
    expect(a.revision).toBe(1);
    expect(await code(r.memories.put(mem(id), null))).toBe('conflict'); // crear dos veces
    expect(await code(r.memories.put(mem(id), 9))).toBe('conflict'); // revisión vieja
    t += 5000;
    const b = await r.memories.put({ ...mem(id), payload: wire(120) }, 1);
    expect(b.revision).toBe(2);
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.updatedAt).toBeGreaterThan(a.updatedAt);
    expect((await r.memories.list({ since: a.updatedAt })).length).toBe(1);
    expect((await r.memories.list({ since: b.updatedAt })).length).toBe(0);
    t += 1000;
    const trashed = await r.memories.trash(id, 2);
    expect(trashed.deletedAt).not.toBeNull();
    expect(await r.memories.list()).toEqual([]);
    expect((await r.memories.list({ includeTrashed: true })).length).toBe(1);
    expect(await code(r.memories.put(mem(id), 3))).toBe('conflict'); // no se edita lo que está en la papelera
    expect(await code(r.memories.trash(id, 3))).toBe('conflict');
    const back = await r.memories.restore(id, 3);
    expect(back.deletedAt).toBeNull();
    expect(await code(r.memories.purge(id))).toBe('conflict'); // solo desde la papelera
    await r.memories.trash(id, 4);
    await r.memories.purge(id);
    expect(await r.memories.get(id)).toBeNull();
    expect(await code(r.memories.purge(id))).toBe('not_found');
  });

  it('rechaza ids y cargas mal formados', async () => {
    const r = await ready();
    expect(await code(r.memories.put(mem('corto'), null))).toBe('invalid');
    expect(await code(r.memories.put({ ...mem(newId()), payload: '<script>' }, null))).toBe(
      'invalid',
    );
    expect(await code(r.memories.put({ ...mem(newId()), payload: 'A'.repeat(65537) }, null))).toBe(
      'invalid',
    );
  });

  it('devuelve copias: modificar lo devuelto no altera el almacén', async () => {
    const r = await ready();
    const id = newId();
    const rec = await r.memories.put(mem(id), null);
    (rec as { payload: string }).payload = 'X';
    expect((await r.memories.get(id))!.payload).toBe(wire());
  });
});

describe('repositorio en memoria: recursos (fotos, miniaturas, avatar)', () => {
  it('límites por tipo, tamaño mínimo y nunca se sobrescribe un id', async () => {
    const r = await ready();
    const p = newId();
    expect(
      await code(
        r.assets.put({
          id: p,
          kind: 'photo',
          parentId: null,
          mkVersion: 1,
          bytes: bytes(MAX_ASSET_BYTES.photo + 1),
        }),
      ),
    ).toBe('too_large');
    expect(
      await code(
        r.assets.put({ id: p, kind: 'photo', parentId: null, mkVersion: 1, bytes: bytes(10) }),
      ),
    ).toBe('invalid');
    expect(
      await code(
        r.assets.put({
          id: p,
          kind: 'avatar',
          parentId: null,
          mkVersion: 1,
          bytes: bytes(MAX_ASSET_BYTES.avatar + 1),
        }),
      ),
    ).toBe('too_large');
    await r.assets.put({
      id: p,
      kind: 'photo',
      parentId: null,
      mkVersion: 1,
      bytes: bytes(MAX_ASSET_BYTES.photo),
    });
    expect(
      await code(
        r.assets.put({ id: p, kind: 'photo', parentId: null, mkVersion: 1, bytes: bytes(100) }),
      ),
    ).toBe('conflict');
    expect(
      await code(
        r.assets.put({
          id: newId(),
          kind: 'thumb',
          parentId: newId(),
          mkVersion: 1,
          bytes: bytes(100),
        }),
      ),
    ).toBe('invalid'); // padre inexistente
    expect(
      await code(
        r.assets.put({ id: newId(), kind: 'photo', parentId: p, mkVersion: 1, bytes: bytes(100) }),
      ),
    ).toBe('invalid'); // una foto no tiene padre
  });

  it('una subida queda pending y no se puede leer hasta ligarla a un recuerdo', async () => {
    const r = await ready();
    const p = newId();
    const t = newId();
    const mid = newId();
    await r.assets.put({ id: p, kind: 'photo', parentId: null, mkVersion: 1, bytes: bytes(500) });
    await r.assets.put({ id: t, kind: 'thumb', parentId: p, mkVersion: 1, bytes: bytes(100) });
    expect(await code(r.assets.getBytes(p))).toBe('not_found');
    expect(await r.assets.list(mid)).toEqual([]);
    await r.memories.put(mem(mid, [p, t]), null);
    const got = await r.assets.getBytes(p);
    expect(got.length).toBe(500);
    got[0] = 99;
    expect((await r.assets.getBytes(p))[0]).toBe(7); // copia, no referencia
    expect((await r.assets.list(mid)).map((a) => a.state)).toEqual(['ready', 'ready']);
  });

  it('un recuerdo no puede apropiarse de recursos ligados a otro ni de ids inexistentes o duplicados', async () => {
    const r = await ready();
    const p = newId();
    const t = newId();
    const m1 = newId();
    const m2 = newId();
    await r.assets.put({ id: p, kind: 'photo', parentId: null, mkVersion: 1, bytes: bytes(100) });
    await r.assets.put({ id: t, kind: 'thumb', parentId: p, mkVersion: 1, bytes: bytes(100) });
    await r.memories.put(mem(m1, [p, t]), null);
    expect(await code(r.memories.put(mem(m2, [p, t]), null))).toBe('conflict');
    expect(await code(r.memories.put(mem(m2, [newId()]), null))).toBe('not_found');
    expect(await code(r.memories.put(mem(m2, [p, p]), null))).toBe('invalid');
    expect(await r.memories.get(m2)).toBeNull(); // nada a medias
  });

  it('hasta 5 fotos con sus miniaturas; la sexta se rechaza sin dejar nada a medias', async () => {
    const r = await ready();
    const mid = newId();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = newId();
      const t = newId();
      await r.assets.put({ id: p, kind: 'photo', parentId: null, mkVersion: 1, bytes: bytes(100) });
      await r.assets.put({ id: t, kind: 'thumb', parentId: p, mkVersion: 1, bytes: bytes(60) });
      ids.push(p, t);
    }
    const sixPhotos = ids.filter((_, i) => i % 2 === 0); // 6 fotos sin miniaturas (6 ids ≤ 10)
    expect(await code(r.memories.put(mem(mid, sixPhotos), null))).toBe('quota'); // la sexta foto
    expect(await code(r.memories.put(mem(mid, ids), null))).toBe('invalid'); // 12 recursos (> 10)
    expect(await code(r.memories.put(mem(mid, ids.slice(0, 11)), null))).toBe('invalid'); // 11 recursos (> 10)
    expect((await r.memories.put(mem(mid, ids.slice(0, 10)), null)).revision).toBe(1); // 5 + 5
    expect((await r.assets.list(mid)).length).toBe(10);
  });

  it('una miniatura debe ir con su foto en el mismo recuerdo', async () => {
    const r = await ready();
    const p = newId();
    const t = newId();
    await r.assets.put({ id: p, kind: 'photo', parentId: null, mkVersion: 1, bytes: bytes(100) });
    await r.assets.put({ id: t, kind: 'thumb', parentId: p, mkVersion: 1, bytes: bytes(60) });
    expect(await code(r.memories.put(mem(newId(), [t]), null))).toBe('invalid');
  });

  it('al editar, lo que se quita del recuerdo se elimina; al purgar, se eliminan todos sus recursos', async () => {
    const r = await ready();
    const mid = newId();
    const mk = async () => {
      const p = newId();
      const t = newId();
      await r.assets.put({ id: p, kind: 'photo', parentId: null, mkVersion: 1, bytes: bytes(100) });
      await r.assets.put({ id: t, kind: 'thumb', parentId: p, mkVersion: 1, bytes: bytes(60) });
      return [p, t] as const;
    };
    const [p1, t1] = await mk();
    const [p2, t2] = await mk();
    await r.memories.put(mem(mid, [p1, t1, p2, t2]), null);
    await r.memories.put(mem(mid, [p1, t1]), 1);
    expect((await r.assets.list(mid)).map((a) => a.id).sort()).toEqual([p1, t1].sort());
    expect(await code(r.assets.getBytes(p2))).toBe('not_found');
    await r.memories.trash(mid, 2);
    await r.memories.purge(mid);
    expect(await code(r.assets.getBytes(p1))).toBe('not_found');
    expect(await r.assets.list(mid)).toEqual([]);
  });

  it('tope de subidas pendientes y cuota total', async () => {
    const r = await ready();
    for (let i = 0; i < MAX_PENDING_ASSETS; i++) {
      await r.assets.put({
        id: newId(),
        kind: 'photo',
        parentId: null,
        mkVersion: 1,
        bytes: bytes(100),
      });
    }
    expect(
      await code(
        r.assets.put({
          id: newId(),
          kind: 'photo',
          parentId: null,
          mkVersion: 1,
          bytes: bytes(100),
        }),
      ),
    ).toBe('quota');
    const small = createDevMemoryRepository({ quotaBytes: 1000 });
    await small.vault.create(newVault());
    await small.assets.put({
      id: newId(),
      kind: 'photo',
      parentId: null,
      mkVersion: 1,
      bytes: bytes(600),
    });
    expect(
      await code(
        small.assets.put({
          id: newId(),
          kind: 'photo',
          parentId: null,
          mkVersion: 1,
          bytes: bytes(600),
        }),
      ),
    ).toBe('quota');
  });

  it('borrar una foto borra su miniatura; borrar lo inexistente es not_found; el avatar queda listo y sin recuerdo', async () => {
    const r = await ready();
    const p = newId();
    const t = newId();
    const av = newId();
    await r.assets.put({ id: p, kind: 'photo', parentId: null, mkVersion: 1, bytes: bytes(100) });
    await r.assets.put({ id: t, kind: 'thumb', parentId: p, mkVersion: 1, bytes: bytes(60) });
    await r.assets.delete(p);
    expect(await code(r.assets.delete(t))).toBe('not_found');
    expect(await code(r.assets.delete(newId()))).toBe('not_found');
    await r.assets.put({ id: av, kind: 'avatar', parentId: null, mkVersion: 1, bytes: bytes(100) });
    expect((await r.assets.getBytes(av)).length).toBe(100);
    expect(await code(r.memories.put(mem(newId(), [av]), null))).toBe('not_found'); // un avatar no se liga a un recuerdo
  });

  it('los errores del repositorio no contienen ids ni contenido', async () => {
    const r = await ready();
    const secretId = newId();
    try {
      await r.memories.put(mem(secretId, [newId()]), null);
    } catch (e) {
      expect((e as Error).message).not.toContain(secretId);
      expect((e as Error).message).toMatch(/^storage:[a-z_]+$/);
    }
  });
});
