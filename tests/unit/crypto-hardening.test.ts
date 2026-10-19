// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { b64uDecode, b64uEncode, randomBytes } from '../../src/lib/crypto/bytes';
import { PRODUCTION_KDF_POLICY } from '../../src/lib/crypto/constants';
import { newId } from '../../src/lib/crypto/ids';
import { parseKdf } from '../../src/lib/crypto/kdf';
import { Keyring } from '../../src/lib/crypto/keyring';
import {
  changePassword,
  createVault,
  disposeMaterial,
  preparePassword,
  prepareRecovery,
  regenerateRecoveryKey,
  resetViaRecovery,
  unwrapWithPassword,
  unwrapWithRecovery,
  upgradeKdf,
} from '../../src/lib/crypto/vault';
import type { VaultWire } from '../../src/lib/crypto/vault';
import { PW, PW2, TEST_POLICY, expectCode } from './_helpers';

const opts = { policy: TEST_POLICY } as const;

/** Instala «trampas» en los almacenes del navegador y en document.cookie: cualquier acceso queda anotado. */
function installStorageTraps(): { hits: string[]; restore: () => void } {
  const hits: string[] = [];
  const names = ['localStorage', 'sessionStorage', 'indexedDB', 'caches'] as const;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const n of names) {
    saved.set(n, Object.getOwnPropertyDescriptor(globalThis, n));
    Object.defineProperty(globalThis, n, {
      configurable: true,
      get() {
        hits.push(n);
        return undefined;
      },
    });
  }
  saved.set('document', Object.getOwnPropertyDescriptor(globalThis, 'document'));
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get cookie(): string {
        hits.push('document.cookie');
        return '';
      },
      set cookie(_v: string) {
        hits.push('document.cookie');
      },
    },
  });
  return {
    hits,
    restore() {
      for (const [n, d] of saved) {
        if (d === undefined) delete (globalThis as Record<string, unknown>)[n];
        else Object.defineProperty(globalThis, n, d);
      }
    },
  };
}

describe('PS-15 (en ejecución): ningún almacén del navegador se toca durante un recorrido completo', () => {
  it('control positivo: las trampas detectan un acceso', () => {
    const t = installStorageTraps();
    try {
      void (globalThis as Record<string, unknown>)['localStorage'];
      void (globalThis as Record<string, unknown>)['indexedDB'];
      (globalThis as unknown as { document: { cookie: string } }).document.cookie = 'x=1';
      expect(t.hits).toEqual(['localStorage', 'indexedDB', 'document.cookie']);
    } finally {
      t.restore();
    }
  });

  it('crear, entrar, cifrar, cambiar contraseña, regenerar, recuperar y bloquear: 0 accesos', async () => {
    const t = installStorageTraps();
    try {
      const mid = newId();
      const c = await createVault(PW, opts);
      const mat = await preparePassword(PW, c.wire.kdf, TEST_POLICY);
      const kr = await unwrapWithPassword(mat, c.wire);
      const blob = await kr.sealMemory(mid, 1, { t: 'x' });
      const aid = newId();
      await kr.openAsset(
        aid,
        'photo',
        mid,
        await kr.sealAsset(aid, 'photo', mid, randomBytes(100)),
      );
      const ch = await changePassword(mat, c.wire, PW2, opts);
      const w2: VaultWire = { ...c.wire, kdf: ch.kdf, wrappedMkPw: ch.wrappedMkPw };
      const mat2 = await preparePassword(PW2, w2.kdf, TEST_POLICY);
      const regen = await regenerateRecoveryKey(mat2, w2);
      const w3: VaultWire = { ...w2, recSalt: regen.recSalt, wrappedMkRec: regen.wrappedMkRec };
      const rec = await prepareRecovery(regen.recoveryKey, w3.recSalt);
      await unwrapWithRecovery(rec, w3);
      const reset = await resetViaRecovery(rec, w3, PW, opts);
      expect(await reset.keyring.openMemory(mid, 1, blob)).toEqual({ t: 'x' });
      for (const m of [mat, mat2, rec]) disposeMaterial(m);
      for (const k of [kr, reset.keyring, c.keyring]) k.lock();
      expect(t.hits).toEqual([]);
    } finally {
      t.restore();
    }
  });
});

describe('claves: no accesibles desde fuera y soltables', () => {
  it('el Keyring no expone ninguna clave: solo vaultId y mkVersion son propiedades visibles', async () => {
    const kr = await Keyring.fromMasterKey(randomBytes(32), newId(), 1);
    expect(Object.getOwnPropertyNames(kr).sort()).toEqual(['mkVersion', 'vaultId']);
    expect(Object.keys(JSON.parse(JSON.stringify(kr)) as object).sort()).toEqual([
      'mkVersion',
      'vaultId',
    ]);
    expect(Object.getOwnPropertySymbols(kr)).toHaveLength(0);
  });

  it('disposeMaterial: tras soltar la clave de envoltura el material deja de servir', async () => {
    const c = await createVault(PW, opts);
    const mat = await preparePassword(PW, c.wire.kdf, TEST_POLICY);
    await unwrapWithPassword(mat, c.wire); // funciona antes
    disposeMaterial(mat);
    await expectCode(unwrapWithPassword(mat, c.wire), 'invalid_input');
    const rec = await prepareRecovery(c.recoveryKey, c.wire.recSalt);
    disposeMaterial(rec);
    await expectCode(unwrapWithRecovery(rec, c.wire), 'invalid_input');
  });

  it('un material copiado a mano (sin su clave registrada) no sirve', async () => {
    const c = await createVault(PW, opts);
    const mat = await preparePassword(PW, c.wire.kdf, TEST_POLICY);
    await expectCode(
      unwrapWithPassword({ authPw: mat.authPw, kdf: mat.kdf }, c.wire),
      'invalid_input',
    );
  });

  it('un Keyring bloqueado no descifra lo que otro Keyring (mismo espacio) sigue pudiendo abrir', async () => {
    const mk = randomBytes(32);
    const vaultId = newId();
    const a = await Keyring.fromMasterKey(mk, vaultId, 1);
    const b = await Keyring.fromMasterKey(mk, vaultId, 1);
    const mid = newId();
    const wire = await a.sealMemory(mid, 1, { v: 1 });
    a.lock();
    await expectCode(a.openMemory(mid, 1, wire), 'locked');
    expect(await b.openMemory(mid, 1, wire)).toEqual({ v: 1 });
  });
});

describe('exportación (K_export) y versión de clave maestra', () => {
  it('ida y vuelta; otro exportId o un sobre de datos no abren', async () => {
    const kr = await Keyring.fromMasterKey(randomBytes(32), newId(), 1);
    const eid = newId();
    const manifest = new TextEncoder().encode('{"manifiesto":true}');
    const env = await kr.sealExport(eid, manifest);
    expect(Array.from(await kr.openExport(eid, env))).toEqual(Array.from(manifest));
    await expectCode(kr.openExport(newId(), env), 'decrypt_failed');
    const dataEnv = b64uDecode(await kr.sealMemory(newId(), 1, { a: 1 }));
    await expectCode(kr.openExport(eid, dataEnv), 'decrypt_failed');
    await expectCode(kr.openMemory(newId(), 1, b64uEncode(env)), 'decrypt_failed');
  });

  it('un Keyring con otra mk_version rechaza lo cifrado con la anterior (no se adivina)', async () => {
    const mk = randomBytes(32);
    const vaultId = newId();
    const v1 = await Keyring.fromMasterKey(mk, vaultId, 1);
    const v2 = await Keyring.fromMasterKey(mk, vaultId, 2);
    const mid = newId();
    const wire = await v1.sealMemory(mid, 1, { a: 1 });
    await expectCode(v2.openMemory(mid, 1, wire), 'format_unsupported');
    const aid = newId();
    const asset = await v1.sealAsset(aid, 'photo', mid, randomBytes(64));
    await expectCode(v2.openAsset(aid, 'photo', mid, asset), 'format_unsupported');
    const env = await v1.sealExport(aid, randomBytes(8));
    await expectCode(v2.openExport(aid, env), 'format_unsupported');
  });

  it('el límite de contenido (32 KiB − 4 B) se aplica al cifrar y al descifrar', async () => {
    const kr = await Keyring.fromMasterKey(randomBytes(32), newId(), 1);
    const mid = newId();
    const tooBig = { t: 'x'.repeat(32 * 1024) };
    await expectCode(kr.sealMemory(mid, 1, tooBig), 'payload_too_large');
    // JSON.stringify({t:"…"}) = 8 B de envoltura + n; con n = 32764 − 8 cabe exactamente en el cubo máximo.
    const fits = { t: 'x'.repeat(32 * 1024 - 4 - 8) };
    expect(await kr.openMemory(mid, 1, await kr.sealMemory(mid, 1, fits))).toEqual(fits);
    await expectCode(
      kr.sealMemory(mid, 1, { t: 'x'.repeat(32 * 1024 - 4 - 8 + 1) }),
      'payload_too_large',
    );
    await expectCode(kr.sealMemory(mid, 1, undefined), 'invalid_input');
  });
});

describe('parámetros de producción (sin política de pruebas)', () => {
  it('un espacio creado con los valores por defecto usa PRODUCTION_KDF_POLICY.targetIter y se abre con la política de producción', async () => {
    const c = await createVault(PW); // sin opciones: política y iteraciones de producción
    expect(parseKdf(c.wire.kdf).iter).toBe(PRODUCTION_KDF_POLICY.targetIter);
    const mid = newId();
    const blob = await c.keyring.sealMemory(mid, 1, { ok: true });
    const kr = await unwrapWithPassword(await preparePassword(PW, c.wire.kdf), c.wire);
    expect(await kr.openMemory(mid, 1, blob)).toEqual({ ok: true });
  }, 120_000);

  it('PS-20 (unidad): si la actualización del KDF no llega al servidor, el registro anterior sigue abriendo', async () => {
    const c = await createVault(PW, opts);
    const mid = newId();
    const blob = await c.keyring.sealMemory(mid, 1, { n: 1 });
    const newer = { ...TEST_POLICY, targetIter: 3000 };
    const mat = await preparePassword(PW, c.wire.kdf, newer);
    const up = await upgradeKdf(mat, c.wire, PW, { policy: newer });
    expect(parseKdf(up.kdf, newer).iter).toBe(3000);
    // «Se corta la red»: la actualización se descarta y el espacio sigue con el registro anterior.
    const again = await unwrapWithPassword(await preparePassword(PW, c.wire.kdf, newer), c.wire);
    expect(await again.openMemory(mid, 1, blob)).toEqual({ n: 1 });
    // Y reintentar más tarde produce otra actualización válida (sal nueva, mismos datos).
    const retry = await upgradeKdf(mat, c.wire, PW, { policy: newer });
    expect(retry.kdf).not.toBe(up.kdf);
    const w2: VaultWire = { ...c.wire, kdf: retry.kdf, wrappedMkPw: retry.wrappedMkPw };
    const k2 = await unwrapWithPassword(await preparePassword(PW, w2.kdf, newer), w2);
    expect(await k2.openMemory(mid, 1, blob)).toEqual({ n: 1 });
  });
});
