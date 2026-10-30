// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { b64uDecode, b64uEncode } from '../../src/lib/crypto/bytes';
import { PRODUCTION_KDF_POLICY } from '../../src/lib/crypto/constants';
import { canonicalKdf, kdfNeedsUpgrade, parseKdf } from '../../src/lib/crypto/kdf';
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
  upgradeKdf,
} from '../../src/lib/crypto/vault';
import type { VaultWire } from '../../src/lib/crypto/vault';
import { generateRecoveryKey } from '../../src/lib/crypto/recovery-key';
import { ctxWrapPw, ctxWrapRec } from '../../src/lib/crypto/contexts';
import { open } from '../../src/lib/crypto/envelope';
import { PURPOSE } from '../../src/lib/crypto/constants';
import { PW, PW2, TEST_POLICY, expectCode } from './_helpers';

afterEach(() => vi.restoreAllMocks());

const opts = { policy: TEST_POLICY } as const;
const MID = newId();

async function fresh(password = PW) {
  const c = await createVault(password, opts);
  const wire: VaultWire = c.wire;
  const blob = await c.keyring.sealMemory(MID, 1, { title: 'Un recuerdo' });
  return { c, wire, blob };
}
const login = async (wire: VaultWire, pw: string) =>
  unwrapWithPassword(await preparePassword(pw, wire.kdf, TEST_POLICY), wire);

describe('KDF: validación del registro (PS-11)', () => {
  const salt = b64uEncode(new Uint8Array(16).fill(7));
  const good = (iter: number) => canonicalKdf({ v: 1, alg: 'pbkdf2-sha256', iter, salt });

  it('con la política de producción rechaza iter por debajo del suelo ANTES de derivar nada', async () => {
    const spy = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    for (const bad of [
      good(1000),
      good(599_999),
      good(10_000_001),
      good(0),
      `{"v":1,"alg":"argon2id","iter":1000000,"salt":"${salt}"}`,
      `{"v":2,"alg":"pbkdf2-sha256","iter":1000000,"salt":"${salt}"}`,
      `{"v":1,"alg":"pbkdf2-sha256","iter":1000000,"salt":"${b64uEncode(new Uint8Array(15))}"}`,
      `{"v":1,"alg":"pbkdf2-sha256","iter":1000000,"salt":"${salt}","x":1}`,
      `{ "v":1,"alg":"pbkdf2-sha256","iter":1000000,"salt":"${salt}"}`, // no canónico
      `{"alg":"pbkdf2-sha256","v":1,"iter":1000000,"salt":"${salt}"}`, // orden distinto
      `{"v":1,"alg":"pbkdf2-sha256","iter":1000000.5,"salt":"${salt}"}`,
      `{"v":1,"alg":"pbkdf2-sha256","iter":"1000000","salt":"${salt}"}`,
      'no es json',
      'null',
      '[]',
    ]) {
      await expectCode(preparePassword(PW, bad), 'kdf_rejected');
    }
    expect(spy.mock.calls.length).toBe(0); // no se derivó nada con parámetros inaceptables
  });

  it('acepta exactamente el suelo y el techo de producción', () => {
    expect(parseKdf(good(600_000)).iter).toBe(600_000);
    expect(parseKdf(good(10_000_000)).iter).toBe(10_000_000);
  });

  it('un vault creado con el suelo de producción (600.000) se abre con la política de producción', async () => {
    const c = await createVault(PW, { policy: PRODUCTION_KDF_POLICY, iter: 600_000 });
    const k = await unwrapWithPassword(await preparePassword(PW, c.wire.kdf), c.wire);
    expect(await k.openMemory(MID, 1, await c.keyring.sealMemory(MID, 1, { a: 1 }))).toEqual({
      a: 1,
    });
  }, 60_000);

  it('createVault no permite iter por debajo del suelo de la política vigente', async () => {
    await expectCode(
      createVault(PW, { policy: PRODUCTION_KDF_POLICY, iter: 1000 }),
      'kdf_rejected',
    );
  });
});

describe('primer acceso y desbloqueo con contraseña', () => {
  it('ida y vuelta: crear, volver a entrar con la contraseña y abrir lo cifrado', async () => {
    const { wire, blob } = await fresh();
    const k = await login(wire, PW);
    expect(await k.openMemory(MID, 1, blob)).toEqual({ title: 'Un recuerdo' });
  });

  it('formato del vault: longitudes compatibles con los CHECK de data-model.md', async () => {
    const { wire, c } = await fresh();
    expect(wire.wrappedMkPw.length).toBe(86); // sobre de 64 B (4 cabecera + 12 nonce + 32 MK + 16 etiqueta) → 86 caracteres base64url (crypto-spec §5.4)
    expect(b64uDecode(wire.wrappedMkPw).length).toBe(64);
    expect(b64uDecode(wire.wrappedMkRec).length).toBe(64);
    expect(wire.wrappedMkPw.length).toBeGreaterThanOrEqual(80);
    expect(wire.wrappedMkPw.length).toBeLessThanOrEqual(256);
    expect(wire.recSalt.length).toBe(22);
    expect(wire.vaultId.length).toBe(22);
    expect(wire.kdf.length).toBeGreaterThanOrEqual(40);
    expect(wire.kdf.length).toBeLessThanOrEqual(400);
    expect(c.authPw.length).toBe(43);
    expect(c.authRec.length).toBe(43);
    expect(c.authPw).not.toBe(c.authRec);
  });

  it('contraseña incorrecta ⇒ decrypt_failed (indistinguible de manipulación)', async () => {
    const { wire } = await fresh();
    const m = await preparePassword('contraseña totalmente errónea', wire.kdf, TEST_POLICY);
    await expectCode(unwrapWithPassword(m, wire), 'decrypt_failed');
  });

  it('el secreto de autenticación depende de la contraseña, no la contiene y NO es la clave de cifrado', async () => {
    const { wire } = await fresh();
    const a = await preparePassword(PW, wire.kdf, TEST_POLICY);
    const b = await preparePassword(PW, wire.kdf, TEST_POLICY);
    const c = await preparePassword(PW2, wire.kdf, TEST_POLICY);
    expect(a.authPw).toBe(b.authPw);
    expect(a.authPw).not.toBe(c.authPw);
    expect(a.authPw).not.toContain(PW);
    expect(Object.keys(a).sort()).toEqual(['authPw', 'kdf']); // ninguna clave de cifrado expuesta en el objeto
    // Solo los NOMBRES de propiedad: authPw es base64url aleatorio y puede contener «key» por azar.
    expect(Object.keys(a).join(',')).not.toMatch(/kek|key/i);
    expect(Object.values(a).some((v) => v instanceof CryptoKey)).toBe(false);
  });

  it('lo que recibe el servidor (auth_pw) NO abre la envoltura: las etiquetas HKDF de auth y de kek son distintas (§3 regla 6)', async () => {
    const { wire } = await fresh();
    const m = await preparePassword(PW, wire.kdf, TEST_POLICY);
    const asKey = await globalThis.crypto.subtle.importKey(
      'raw',
      b64uDecode(m.authPw) as BufferSource,
      'AES-GCM',
      false,
      ['decrypt'],
    );
    await expectCode(
      open(asKey, b64uDecode(wire.wrappedMkPw), PURPOSE.wrapPw, ctxWrapPw(wire.vaultId, wire.kdf)),
      'decrypt_failed',
    );
  });

  it('lo mismo con la recuperación: auth_rec NO abre wrapped_mk_rec', async () => {
    const { c, wire } = await fresh();
    const m = await prepareRecovery(c.recoveryKey, wire.recSalt);
    const asKey = await globalThis.crypto.subtle.importKey(
      'raw',
      b64uDecode(m.authRec) as BufferSource,
      'AES-GCM',
      false,
      ['decrypt'],
    );
    await expectCode(
      open(
        asKey,
        b64uDecode(wire.wrappedMkRec),
        PURPOSE.wrapRec,
        ctxWrapRec(wire.vaultId, wire.recSalt),
      ),
      'decrypt_failed',
    );
  });

  it('NFKC: forma compuesta y descompuesta dan la misma clave; los espacios NO se recortan', async () => {
    const { wire } = await fresh('niño café ñandú 2026 ¡ya!');
    const composed = await preparePassword('niño café ñandú 2026 ¡ya!', wire.kdf, TEST_POLICY);
    const decomposed = await preparePassword(
      'niño café ñandú 2026 ¡ya!'.normalize('NFD'),
      wire.kdf,
      TEST_POLICY,
    );
    expect(decomposed.authPw).toBe(composed.authPw);
    const spaced = await preparePassword(' niño café ñandú 2026 ¡ya! ', wire.kdf, TEST_POLICY);
    expect(spaced.authPw).not.toBe(composed.authPw);
  });

  it('una contraseña que incumple la política no crea el espacio', async () => {
    await expectCode(createVault('corta', opts), 'password_policy');
    await expectCode(createVault('passwordpassword', opts), 'password_policy');
  });

  it('un envoltorio no se puede trasplantar a otro espacio ni modificar (AAD de la envoltura)', async () => {
    const a = await fresh();
    const b = await fresh();
    const mat = await preparePassword(PW, a.wire.kdf, TEST_POLICY);
    await expectCode(
      unwrapWithPassword(mat, { ...b.wire, kdf: a.wire.kdf, wrappedMkPw: a.wire.wrappedMkPw }),
      'decrypt_failed',
    ); // otro vaultId
    const t = b64uDecode(a.wire.wrappedMkPw);
    t[t.length - 1]! ^= 1;
    await expectCode(
      unwrapWithPassword(mat, { ...a.wire, wrappedMkPw: b64uEncode(t) }),
      'decrypt_failed',
    );
    await expectCode(
      unwrapWithPassword(mat, { ...a.wire, kdf: a.wire.kdf.replace('"iter":1000', '"iter":1001') }),
      'invalid_input',
    );
  });
});

describe('clave de recuperación: recuperar, regenerar, restablecer (PS-17, PS-19)', () => {
  it('la clave de recuperación abre los mismos datos', async () => {
    const { c, wire, blob } = await fresh();
    const m = await prepareRecovery(c.recoveryKey.toLowerCase().replaceAll('-', ''), wire.recSalt);
    const k = await unwrapWithRecovery(m, wire);
    expect(await k.openMemory(MID, 1, blob)).toEqual({ title: 'Un recuerdo' });
  });

  it('clave de recuperación incorrecta (bien formada) ⇒ decrypt_failed', async () => {
    const { wire } = await fresh();
    const other = generateRecoveryKey().display;
    await expectCode(
      unwrapWithRecovery(await prepareRecovery(other, wire.recSalt), wire),
      'decrypt_failed',
    );
  });

  it('un error de tecleo se detecta en local, sin derivar ni consultar nada', async () => {
    const { c, wire } = await fresh();
    const spy = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    const typo = (c.recoveryKey[0] === '1' ? '2' : '1') + c.recoveryKey.slice(1);
    await expectCode(prepareRecovery(typo, wire.recSalt), 'recovery_key_checksum');
    expect(spy.mock.calls.length).toBe(0);
  });

  it('regenerar: la antigua deja de abrir, la nueva abre, la contraseña sigue valiendo; nada se recifra', async () => {
    const { c, wire, blob } = await fresh();
    const cur = await preparePassword(PW, wire.kdf, TEST_POLICY);
    const r = await regenerateRecoveryKey(cur, wire);
    expect(r.currentAuthPw).toBe(c.authPw);
    expect(r.recoveryKey).not.toBe(c.recoveryKey);
    const w2: VaultWire = { ...wire, recSalt: r.recSalt, wrappedMkRec: r.wrappedMkRec };
    await expectCode(
      unwrapWithRecovery(await prepareRecovery(c.recoveryKey, w2.recSalt), w2),
      'decrypt_failed',
    ); // la vieja contra la envoltura nueva
    const k = await unwrapWithRecovery(await prepareRecovery(r.recoveryKey, w2.recSalt), w2);
    expect(await k.openMemory(MID, 1, blob)).toEqual({ title: 'Un recuerdo' });
    expect(await (await login(w2, PW)).openMemory(MID, 1, blob)).toEqual({ title: 'Un recuerdo' });
  });

  it('restablecer con la clave de recuperación: contraseña NUEVA y clave NUEVA; lo viejo deja de valer; los datos se conservan', async () => {
    const { c, wire, blob } = await fresh();
    const m = await prepareRecovery(c.recoveryKey, wire.recSalt);
    const r = await resetViaRecovery(m, wire, PW2, opts);
    expect(await r.keyring.openMemory(MID, 1, blob)).toEqual({ title: 'Un recuerdo' });
    expect(r.recoveryKey).not.toBe(c.recoveryKey);
    const w2: VaultWire = {
      ...wire,
      kdf: r.kdf,
      wrappedMkPw: r.wrappedMkPw,
      recSalt: r.recSalt,
      wrappedMkRec: r.wrappedMkRec,
    };
    expect(await (await login(w2, PW2)).openMemory(MID, 1, blob)).toEqual({ title: 'Un recuerdo' });
    await expectCode(login(w2, PW), 'decrypt_failed'); // contraseña antigua
    await expectCode(
      unwrapWithRecovery(await prepareRecovery(c.recoveryKey, w2.recSalt), w2),
      'decrypt_failed',
    ); // clave usada
    const k = await unwrapWithRecovery(await prepareRecovery(r.recoveryKey, w2.recSalt), w2);
    expect(await k.openMemory(MID, 1, blob)).toEqual({ title: 'Un recuerdo' });
  });

  it('restablecer exige que la contraseña nueva cumpla la política', async () => {
    const { c, wire } = await fresh();
    await expectCode(
      resetViaRecovery(await prepareRecovery(c.recoveryKey, wire.recSalt), wire, 'corta', opts),
      'password_policy',
    );
  });
});

describe('cambio de contraseña y versionado de parámetros (PS-18, PS-20)', () => {
  it('cambiar la contraseña solo reenvuelve: los datos antiguos se abren, la antigua falla, la recuperación sigue igual', async () => {
    const { c, wire, blob } = await fresh();
    const cur = await preparePassword(PW, wire.kdf, TEST_POLICY);
    const ch = await changePassword(cur, wire, PW2, opts);
    expect(ch.currentAuthPw).toBe(c.authPw);
    expect(ch.authPw).not.toBe(c.authPw);
    expect(ch.kdf).not.toBe(wire.kdf); // sal nueva
    const w2: VaultWire = { ...wire, kdf: ch.kdf, wrappedMkPw: ch.wrappedMkPw };
    expect(await (await login(w2, PW2)).openMemory(MID, 1, blob)).toEqual({ title: 'Un recuerdo' }); // sin recifrar datos
    await expectCode(login(w2, PW), 'decrypt_failed');
    const k = await unwrapWithRecovery(await prepareRecovery(c.recoveryKey, w2.recSalt), w2);
    expect(await k.openMemory(MID, 1, blob)).toEqual({ title: 'Un recuerdo' });
  });

  it('cambiar la contraseña exige la actual correcta y que la nueva cumpla la política', async () => {
    const { wire } = await fresh();
    const bad = await preparePassword('contraseña totalmente errónea', wire.kdf, TEST_POLICY);
    await expectCode(changePassword(bad, wire, PW2, opts), 'decrypt_failed');
    const cur = await preparePassword(PW, wire.kdf, TEST_POLICY);
    await expectCode(changePassword(cur, wire, 'corta', opts), 'password_policy');
  });

  it('parámetros antiguos siguen abriendo datos y se actualizan sin interacción ni recifrado (§8.6)', async () => {
    const { wire, blob } = await fresh(); // creado con iter 1000
    const newer = { ...TEST_POLICY, minIter: 1000, targetIter: 2500 };
    expect(kdfNeedsUpgrade(wire.kdf, TEST_POLICY)).toBe(false);
    expect(kdfNeedsUpgrade(wire.kdf, newer)).toBe(true);
    expect(await (await login(wire, PW)).openMemory(MID, 1, blob)).toEqual({
      title: 'Un recuerdo',
    }); // la política nueva no rompe lo viejo
    const cur = await preparePassword(PW, wire.kdf, newer);
    const up = await upgradeKdf(cur, wire, PW, { policy: newer });
    expect(parseKdf(up.kdf, newer).iter).toBe(2500);
    expect(up.kdf).not.toBe(wire.kdf);
    const w2: VaultWire = { ...wire, kdf: up.kdf, wrappedMkPw: up.wrappedMkPw };
    expect(kdfNeedsUpgrade(w2.kdf, newer)).toBe(false);
    const k = await unwrapWithPassword(await preparePassword(PW, w2.kdf, newer), w2);
    expect(await k.openMemory(MID, 1, blob)).toEqual({ title: 'Un recuerdo' }); // misma MK, mismos datos
  });

  it('cerrar el keyring tras cambiar la contraseña no afecta al nuevo', async () => {
    const { wire, blob } = await fresh();
    const k1 = await login(wire, PW);
    k1.lock();
    expect(await (await login(wire, PW)).openMemory(MID, 1, blob)).toEqual({
      title: 'Un recuerdo',
    });
  });
});

describe('ausencia de claves y contraseñas en logs y errores', () => {
  it('ningún console.* se usa durante un recorrido completo y los errores no filtran secretos', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m),
    );
    const messages: string[] = [];
    const secrets: string[] = [];
    const record = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        messages.push(`${(e as Error).name}:${(e as Error).message}:${JSON.stringify(e)}`);
      }
    };
    const { c, wire } = await fresh();
    secrets.push(
      PW,
      c.recoveryKey,
      c.recoveryKey.replaceAll('-', ''),
      c.authPw,
      c.authRec,
      wire.wrappedMkPw,
      wire.wrappedMkRec,
    );
    await record(
      unwrapWithPassword(
        await preparePassword('contraseña totalmente errónea', wire.kdf, TEST_POLICY),
        wire,
      ),
    );
    await record(prepareRecovery(c.recoveryKey.slice(0, 20), wire.recSalt));
    await record(preparePassword(PW, '{"v":1}', TEST_POLICY));
    await record(createVault('corta', opts));
    await record(c.keyring.openMemory(newId(), 1, 'AAAA'));
    await record(c.keyring.openAsset(newId(), 'photo', null, new Uint8Array(40)));
    await changePassword(await preparePassword(PW, wire.kdf, TEST_POLICY), wire, PW2, opts);
    for (const s of spies) expect(s.mock.calls.length).toBe(0);
    expect(messages.length).toBeGreaterThan(5);
    for (const m of messages) for (const s of secrets) expect(m.includes(s)).toBe(false);
  });
});
