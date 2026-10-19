// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { b64uDecode } from '../../src/lib/crypto/bytes';
import { newId } from '../../src/lib/crypto/ids';
import {
  changePassword,
  createVault,
  preparePassword,
  prepareRecovery,
  regenerateRecoveryKey,
  resetViaRecovery,
  unwrapWithPassword,
  unwrapWithRecovery,
} from '../../src/lib/crypto/vault';
import type { VaultWire } from '../../src/lib/crypto/vault';
import { createDevMemoryRepository } from '../../src/lib/storage/dev-memory-adapter';
import { StorageError } from '../../src/lib/storage/errors';
import type { Repository, VaultRecord } from '../../src/lib/storage/types';
import { PW, PW2, TEST_POLICY, expectCode } from './_helpers';

/**
 * Cliente (crypto) + «servidor» (repositorio en memoria) juntos: lo único que cruza la frontera son cadenas
 * y bytes cifrados. Esto es lo que H5 (pantallas) y H7 (API real) repetirán con otro adaptador.
 */
const opts = { policy: TEST_POLICY } as const;
const SECRET_TEXT = 'TEXTO-PERSONAL-ÚNICO-ñ-🌸-7731';

const toWire = (r: VaultRecord): VaultWire => ({
  vaultId: r.id,
  kdf: r.kdf,
  mkVersion: r.mkVersion,
  wrappedMkPw: r.wrappedMkPw,
  recSalt: r.recSalt,
  wrappedMkRec: r.wrappedMkRec,
});

async function setup(): Promise<{ repo: Repository; recoveryKey: string }> {
  const repo = createDevMemoryRepository();
  const c = await createVault(PW, opts);
  await repo.vault.create({
    id: c.wire.vaultId,
    kdf: c.wire.kdf,
    mkVersion: c.wire.mkVersion,
    wrappedMkPw: c.wire.wrappedMkPw,
    recSalt: c.wire.recSalt,
    wrappedMkRec: c.wire.wrappedMkRec,
  });
  return { repo, recoveryKey: c.recoveryKey };
}
async function login(repo: Repository, pw: string) {
  const rec = (await repo.vault.get())!;
  return {
    rec,
    keyring: await unwrapWithPassword(await preparePassword(pw, rec.kdf, TEST_POLICY), toWire(rec)),
  };
}
const contains = (hay: Uint8Array, needle: string): boolean =>
  Buffer.from(hay).includes(Buffer.from(needle, 'utf8'));

describe('recorrido completo con el repositorio', () => {
  it('guardar y releer un recuerdo: el repositorio solo ve texto cifrado y lo descifrado es idéntico', async () => {
    const { repo } = await setup();
    const { keyring } = await login(repo, PW);
    const id = newId();
    const payload = { title: SECRET_TEXT, text: SECRET_TEXT + SECRET_TEXT, flower: 'rosa' };
    const wire = await keyring.sealMemory(id, 1, payload);
    const saved = await repo.memories.put(
      { id, payload: wire, schemaVersion: 1, mkVersion: keyring.mkVersion, assetIds: [] },
      null,
    );
    // el servidor no ve texto en claro, ni en el payload ni en ningún campo del registro
    expect(contains(b64uDecode(saved.payload), 'TEXTO-PERSONAL')).toBe(false);
    expect(wire).not.toContain('TEXTO');
    expect(JSON.stringify(saved)).not.toContain('PERSONAL');
    const { keyring: k2 } = await login(repo, PW); // «otro dispositivo»
    const got = (await repo.memories.get(id))!;
    expect(await k2.openMemory(id, got.schemaVersion, got.payload)).toEqual(payload);
  });

  it('un servidor que intercambia los blobs de dos recuerdos es detectado (PS-09 en el recorrido real)', async () => {
    const { repo } = await setup();
    const { keyring } = await login(repo, PW);
    const [a, b] = [newId(), newId()];
    for (const [id, t] of [
      [a, 'uno'],
      [b, 'dos'],
    ] as const) {
      await repo.memories.put(
        {
          id,
          payload: await keyring.sealMemory(id, 1, { t }),
          schemaVersion: 1,
          mkVersion: 1,
          assetIds: [],
        },
        null,
      );
    }
    const ra = (await repo.memories.get(a))!;
    const rb = (await repo.memories.get(b))!;
    await expectCode(keyring.openMemory(a, 1, rb.payload), 'decrypt_failed');
    await expectCode(keyring.openMemory(b, 1, ra.payload), 'decrypt_failed');
    expect(await keyring.openMemory(a, 1, ra.payload)).toEqual({ t: 'uno' });
  });

  it('ajustes: la revisión nueva (expected+1) entra en el AAD y un blob de otra revisión no abre', async () => {
    const { repo } = await setup();
    const { keyring } = await login(repo, PW);
    const s = await repo.vault.getSettings();
    expect(s).toEqual({ payload: null, revision: 0 });
    const w1 = await keyring.sealSettings(s.revision + 1, { displayName: 'Lucía' });
    const { revision } = await repo.vault.putSettings(w1, s.revision);
    expect(revision).toBe(1);
    const stored = await repo.vault.getSettings();
    expect(await keyring.openSettings(stored.revision, stored.payload!)).toEqual({
      displayName: 'Lucía',
    });
    await expectCode(keyring.openSettings(stored.revision + 1, stored.payload!), 'decrypt_failed');
  });

  it('fotos: subir cifradas, ligar al recuerdo, releer y descifrar; el servidor no ve la imagen', async () => {
    const { repo } = await setup();
    const { keyring } = await login(repo, PW);
    const mid = newId();
    const [pid, tid] = [newId(), newId()];
    const photo = new Uint8Array(2000).map((_, i) => (i * 7) & 255);
    const thumb = new Uint8Array(300).map((_, i) => (i * 3) & 255);
    await repo.assets.put({
      id: pid,
      kind: 'photo',
      parentId: null,
      mkVersion: 1,
      bytes: await keyring.sealAsset(pid, 'photo', mid, photo),
    });
    await repo.assets.put({
      id: tid,
      kind: 'thumb',
      parentId: pid,
      mkVersion: 1,
      bytes: await keyring.sealAsset(tid, 'thumb', mid, thumb),
    });
    await repo.memories.put(
      {
        id: mid,
        payload: await keyring.sealMemory(mid, 1, { photos: [pid] }),
        schemaVersion: 1,
        mkVersion: 1,
        assetIds: [pid, tid],
      },
      null,
    );
    const stored = await repo.assets.getBytes(pid);
    expect(Buffer.from(stored).includes(Buffer.from(photo.subarray(0, 64)))).toBe(false); // no hay trozos en claro
    expect(Array.from(await keyring.openAsset(pid, 'photo', mid, stored))).toEqual(
      Array.from(photo),
    );
    // intercambiar foto y miniatura, o usarla en otro recuerdo, falla
    await expectCode(keyring.openAsset(tid, 'thumb', mid, stored), 'decrypt_failed');
    await expectCode(keyring.openAsset(pid, 'photo', newId(), stored), 'decrypt_failed');
    await expectCode(keyring.openAsset(pid, 'thumb', mid, stored), 'decrypt_failed');
  });
});

describe('cambios de claves contra el repositorio (concurrencia por keyRevision)', () => {
  it('cambiar la contraseña: replaceKeys con la revisión esperada; los recuerdos NO se tocan y siguen abriendo', async () => {
    const { repo } = await setup();
    const { rec, keyring } = await login(repo, PW);
    const id = newId();
    const blob = await keyring.sealMemory(id, 1, { t: 'x' });
    await repo.memories.put(
      { id, payload: blob, schemaVersion: 1, mkVersion: 1, assetIds: [] },
      null,
    );
    const before = (await repo.memories.get(id))!;

    const cur = await preparePassword(PW, rec.kdf, TEST_POLICY);
    const change = await changePassword(cur, toWire(rec), PW2, opts);
    expect(change.currentAuthPw).toBe(cur.authPw);
    const after = await repo.vault.replaceKeys(
      { kdf: change.kdf, wrappedMkPw: change.wrappedMkPw },
      rec.keyRevision,
    );
    expect(after.keyRevision).toBe(rec.keyRevision + 1);
    // otro dispositivo con la revisión vieja pierde la carrera
    const stale = await changePassword(cur, toWire(rec), 'una tercera contraseña larga', opts);
    const lost = await repo.vault
      .replaceKeys({ kdf: stale.kdf, wrappedMkPw: stale.wrappedMkPw }, rec.keyRevision)
      .catch((e: unknown) => e);
    expect(lost).toBeInstanceOf(StorageError);
    expect((lost as StorageError).code).toBe('conflict');

    expect(await repo.memories.get(id)).toEqual(before); // ni un byte de los datos cambió
    await expectCode(login(repo, PW), 'decrypt_failed'); // la contraseña antigua ya no sirve
    const { keyring: k2 } = await login(repo, PW2);
    expect(await k2.openMemory(id, 1, before.payload)).toEqual({ t: 'x' });
  });

  it('recuperación: abre los datos, fija contraseña y clave nuevas y deja de valer la clave vieja', async () => {
    const { repo, recoveryKey } = await setup();
    const { rec, keyring } = await login(repo, PW);
    const id = newId();
    await repo.memories.put(
      {
        id,
        payload: await keyring.sealMemory(id, 1, { t: 'y' }),
        schemaVersion: 1,
        mkVersion: 1,
        assetIds: [],
      },
      null,
    );

    const m = await prepareRecovery(recoveryKey, rec.recSalt);
    const old = await unwrapWithRecovery(m, toWire(rec));
    expect(await old.openMemory(id, 1, (await repo.memories.get(id))!.payload)).toEqual({ t: 'y' });
    const reset = await resetViaRecovery(m, toWire(rec), PW2, opts);
    await repo.vault.replaceKeys(
      {
        kdf: reset.kdf,
        wrappedMkPw: reset.wrappedMkPw,
        recSalt: reset.recSalt,
        wrappedMkRec: reset.wrappedMkRec,
      },
      rec.keyRevision,
    );
    expect(reset.recoveryKey).not.toBe(recoveryKey);
    const nowRec = (await repo.vault.get())!;
    await expectCode(
      prepareRecovery(recoveryKey, nowRec.recSalt).then((x) =>
        unwrapWithRecovery(x, toWire(nowRec)),
      ),
      'decrypt_failed',
    );
    const { keyring: k2 } = await login(repo, PW2);
    expect(await k2.openMemory(id, 1, (await repo.memories.get(id))!.payload)).toEqual({ t: 'y' });
  });

  it('regenerar la clave de recuperación: solo cambia la envoltura de recuperación', async () => {
    const { repo, recoveryKey } = await setup();
    const { rec } = await login(repo, PW);
    const cur = await preparePassword(PW, rec.kdf, TEST_POLICY);
    const regen = await regenerateRecoveryKey(cur, toWire(rec));
    const after = await repo.vault.replaceKeys(
      { recSalt: regen.recSalt, wrappedMkRec: regen.wrappedMkRec },
      rec.keyRevision,
    );
    expect(after.wrappedMkPw).toBe(rec.wrappedMkPw);
    expect(after.kdf).toBe(rec.kdf);
    expect(regen.recoveryKey).not.toBe(recoveryKey);
    await expectCode(
      prepareRecovery(recoveryKey, after.recSalt).then((x) => unwrapWithRecovery(x, toWire(after))),
      'decrypt_failed',
    );
    const m = await prepareRecovery(regen.recoveryKey, after.recSalt);
    expect((await unwrapWithRecovery(m, toWire(after))).vaultId).toBe(rec.id);
  });
});
