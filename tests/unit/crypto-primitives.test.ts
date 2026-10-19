// @vitest-environment node
import { createCipheriv, randomBytes as nodeRandom } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { b64uDecode, b64uEncode, randomBytes } from '../../src/lib/crypto/bytes';
import {
  PAD_BUCKETS,
  PURPOSE,
  ENVELOPE_OVERHEAD,
  MAX_CONTENT_BYTES,
} from '../../src/lib/crypto/constants';
import { ctxMemory } from '../../src/lib/crypto/contexts';
import { open, seal, sealWithNonce } from '../../src/lib/crypto/envelope';
import { newId, isId } from '../../src/lib/crypto/ids';
import { Keyring } from '../../src/lib/crypto/keyring';
import { pad, unpad } from '../../src/lib/crypto/padding';
import { checkPasswordPolicy, generatePassphrase } from '../../src/lib/crypto/password-policy';
import {
  crc10,
  deriveRecoverySecrets,
  generateRecoveryKey,
  isRecoveryKeyWellFormed,
  normalizeRecoveryInput,
  parseRecoveryKey,
  recoveryKeyFromBytes,
} from '../../src/lib/crypto/recovery-key';
import { expectCode, expectCodeSync, fromHex, hex } from './_helpers';

afterEach(() => vi.restoreAllMocks());

const aesKey = (
  usages: KeyUsage[] = ['encrypt', 'decrypt'],
  raw: Uint8Array = randomBytes(32),
): Promise<CryptoKey> =>
  globalThis.crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, usages);

describe('base64url estricto', () => {
  it('ida y vuelta para todas las longitudes 0..64', () => {
    for (let n = 0; n <= 64; n++) {
      const b = randomBytes(n);
      expect(b64uDecode(b64uEncode(b))).toEqual(b);
    }
  });
  it('rechaza alfabeto ajeno, relleno, longitud imposible y bits finales no nulos', () => {
    for (const bad of ['AA+A', 'AA/A', 'AAA=', 'A', 'AAAAA', 'AB', 'AAB', ' AAA', 'ÁAAA']) {
      expectCodeSync(() => b64uDecode(bad), 'invalid_input');
    }
  });
  it('ids: 22 caracteres, únicos y reconocibles', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
    for (const i of ids) expect(isId(i)).toBe(true);
    expect(isId('corto')).toBe(false);
  });
});

describe('relleno en cubos (PS-47)', () => {
  it('cada contenido ocupa el menor cubo que lo contiene (4 B de prefijo incluidos)', () => {
    expect(pad(new Uint8Array(0)).length).toBe(1024);
    expect(pad(new Uint8Array(1020)).length).toBe(1024);
    expect(pad(new Uint8Array(1021)).length).toBe(2048);
    expect(pad(new Uint8Array(MAX_CONTENT_BYTES)).length).toBe(32768);
  });
  it('rechaza más del máximo real (32 KiB − 4 B, corrección de §5.5)', () => {
    expectCodeSync(() => pad(new Uint8Array(MAX_CONTENT_BYTES + 1)), 'payload_too_large');
  });
  it('ida y vuelta y el relleno son ceros', () => {
    const c = randomBytes(777);
    expect(unpad(pad(c))).toEqual(c);
  });
  it('unpad rechaza tamaño no cubo, longitud imposible y relleno no nulo', () => {
    expectCodeSync(() => unpad(new Uint8Array(1000)), 'decrypt_failed');
    const bad = pad(randomBytes(10));
    bad[500] = 1;
    expectCodeSync(() => unpad(bad), 'decrypt_failed');
    const lenBad = pad(randomBytes(10));
    new DataView(lenBad.buffer).setUint32(0, 5000, false);
    expectCodeSync(() => unpad(lenBad), 'decrypt_failed');
  });
  it('mismo tamaño cifrado dentro del cubo; cubo siguiente al cruzarlo (recuerdos de 10, 500 y 3000 caracteres)', async () => {
    const mk = randomBytes(32);
    const kr = await Keyring.fromMasterKey(mk, newId(), 1);
    const size = async (n: number): Promise<number> =>
      b64uDecode(await kr.sealMemory(newId(), 1, { t: 'x'.repeat(n) })).length;
    const [a, b, c] = [await size(10), await size(500), await size(3000)];
    expect(a).toBe(1024 + ENVELOPE_OVERHEAD);
    expect(b).toBe(a);
    expect(c).toBe(4096 + ENVELOPE_OVERHEAD); // 3000 caracteres NO caben en el cubo de 10 y 500 (corrección de PS-47)
    for (const bucket of PAD_BUCKETS) expect(bucket % 1024).toBe(0);
  });
});

describe('envoltorio: formato (PS-12) y nonces (PS-08)', () => {
  it('formato: cabecera(4) || nonce(12) || texto cifrado || etiqueta(16), idéntico a node:crypto', async () => {
    const raw = nodeRandom(32);
    const nonce = nodeRandom(12);
    const key = await aesKey(['encrypt', 'decrypt'], new Uint8Array(raw));
    const ctx = 'mg1|memory|ctx';
    const pt = nodeRandom(64);
    const env = await sealWithNonce(
      key,
      new Uint8Array(pt),
      PURPOSE.data,
      1,
      ctx,
      new Uint8Array(nonce),
    );
    const header = Buffer.from([0x01, 0x01, 0x01, 0x01]);
    const c = createCipheriv('aes-256-gcm', raw, nonce, { authTagLength: 16 });
    c.setAAD(Buffer.concat([header, Buffer.from(ctx)]));
    const expected = Buffer.concat([header, nonce, c.update(pt), c.final(), c.getAuthTag()]);
    expect(hex(env)).toBe(expected.toString('hex'));
    expect(env.length).toBe(pt.length + ENVELOPE_OVERHEAD);
  });

  it('100.000 cifrados con la misma clave: 0 nonces repetidos y todos de getRandomValues (PS-08)', async () => {
    const key = await aesKey();
    const recorded: string[] = [];
    // La función original se captura ANTES de espiar: si no, con Vitest real `real` sería el propio espía y se llamaría a sí mismo.
    const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    spy.mockImplementation(((arr: Uint8Array<ArrayBuffer>) => {
      real(arr);
      if (arr.length === 12) recorded.push(hex(arr));
      return arr;
    }) as never);
    const N = 100_000;
    const firstEnvelopes: Uint8Array[] = [];
    const pt = new Uint8Array(16);
    for (let i = 0; i < N; i++) {
      const env = await seal(key, pt, PURPOSE.data, 1, 'mg1|test');
      if (i < 50) firstEnvelopes.push(env);
    }
    spy.mockRestore();
    expect(recorded.length).toBe(N); // un nonce de 12 B por cifrado, ni más ni menos
    expect(new Set(recorded).size).toBe(N);
    firstEnvelopes.forEach((env, i) => expect(hex(env.subarray(4, 16))).toBe(recorded[i]!)); // el nonce del sobre ES el generado
  }, 120_000);

  it('el cifrado es no determinista: mismo texto y contexto dan sobres distintos', async () => {
    const key = await aesKey();
    const a = await seal(key, new Uint8Array(8), PURPOSE.data, 1, 'c');
    const b = await seal(key, new Uint8Array(8), PURPOSE.data, 1, 'c');
    expect(hex(a)).not.toBe(hex(b));
  });
});

describe('manipulación y AAD (PS-09, PS-10)', () => {
  const setup = async () => {
    const mk = randomBytes(32);
    const vaultId = newId();
    const kr = await Keyring.fromMasterKey(mk, vaultId, 1);
    return { mk, vaultId, kr };
  };

  it('ida y vuelta de recuerdo, ajustes y foto', async () => {
    const { kr } = await setup();
    const mid = newId();
    const value = { title: 'Primer viaje', n: 3, ñ: 'áéí😀' };
    expect(await kr.openMemory(mid, 1, await kr.sealMemory(mid, 1, value))).toEqual(value);
    expect(await kr.openSettings(4, await kr.sealSettings(4, { a: 1 }))).toEqual({ a: 1 });
    const aid = newId();
    const photo = randomBytes(5000);
    expect(
      await kr.openAsset(aid, 'photo', mid, await kr.sealAsset(aid, 'photo', mid, photo)),
    ).toEqual(photo);
  });

  it('PS-09: cambiar id, vault, versión, tipo o recuerdo de un blob hace fallar el descifrado', async () => {
    const { mk, vaultId, kr } = await setup();
    const mid = newId();
    const wire = await kr.sealMemory(mid, 1, { x: 1 });
    await expectCode(kr.openMemory(newId(), 1, wire), 'decrypt_failed'); // intercambio entre ids
    await expectCode(kr.openMemory(mid, 2, wire), 'decrypt_failed'); // otra versión de esquema
    const otherVault = await Keyring.fromMasterKey(mk, newId(), 1); // MISMAS claves, otro vault: solo el AAD lo distingue
    await expectCode(otherVault.openMemory(mid, 1, wire), 'decrypt_failed');
    expect(
      await Keyring.fromMasterKey(mk, vaultId, 1).then((k) => k.openMemory(mid, 1, wire)),
    ).toEqual({ x: 1 });

    const sWire = await kr.sealSettings(3, { y: 2 });
    await expectCode(kr.openSettings(2, sWire), 'decrypt_failed'); // otra revisión de ajustes

    const aid = newId();
    const env = await kr.sealAsset(aid, 'photo', mid, randomBytes(100));
    await expectCode(kr.openAsset(newId(), 'photo', mid, env), 'decrypt_failed');
    await expectCode(kr.openAsset(aid, 'thumb', mid, env), 'decrypt_failed');
    await expectCode(kr.openAsset(aid, 'photo', newId(), env), 'decrypt_failed');
    await expectCode(kr.openAsset(aid, 'photo', null, env), 'decrypt_failed');
  });

  it('un blob de datos no se abre como recurso ni al revés (finalidad y clave distintas)', async () => {
    const { kr } = await setup();
    const mid = newId();
    const aid = newId();
    const dataEnv = b64uDecode(await kr.sealMemory(mid, 1, { a: 1 }));
    await expectCode(kr.openAsset(aid, 'photo', mid, dataEnv), 'decrypt_failed');
    const assetEnv = await kr.sealAsset(aid, 'photo', mid, randomBytes(2000));
    await expectCode(kr.openMemory(mid, 1, b64uEncode(assetEnv)), 'decrypt_failed');
  });

  it('la finalidad de la cabecera se exige aunque la clave y el contexto coincidan (defensa en profundidad)', async () => {
    // Mutante detectado en la revisión de la suite: sin esta comprobación explícita nada más lo notaba, porque ningún
    // código sella con otra finalidad bajo la misma clave y contexto. Aquí se fuerza ese caso a mano.
    const key = await aesKey();
    const env = await seal(
      key,
      new TextEncoder().encode('hola'),
      PURPOSE.asset,
      1,
      'mg1|mismo-contexto',
    );
    expect(hex((await open(key, env, PURPOSE.asset, 'mg1|mismo-contexto')).plaintext)).toBe(
      hex(new TextEncoder().encode('hola')),
    );
    await expectCode(open(key, env, PURPOSE.data, 'mg1|mismo-contexto'), 'decrypt_failed');
  });

  it('PS-10: alterar un bit de CADA byte de un sobre real, truncar o ampliar siempre falla sin devolver texto', async () => {
    const { kr } = await setup();
    const aid = newId();
    const mid = newId();
    const env = await kr.sealAsset(
      aid,
      'photo',
      mid,
      new TextEncoder().encode('texto secreto de prueba'),
    );
    for (let i = 0; i < env.length; i++) {
      const t = new Uint8Array(env);
      t[i]! ^= 0x01;
      let ok = false;
      try {
        await kr.openAsset(aid, 'photo', mid, t);
        ok = true;
      } catch (e) {
        expect(String((e as Error).message)).not.toContain('secreto');
      }
      expect(ok).toBe(false);
    }
    await expectCode(
      kr.openAsset(aid, 'photo', mid, env.subarray(0, env.length - 1)),
      'decrypt_failed',
    );
    await expectCode(
      kr.openAsset(aid, 'photo', mid, new Uint8Array([...env, 0])),
      'decrypt_failed',
    );
    await expectCode(kr.openAsset(aid, 'photo', mid, new Uint8Array(0)), 'decrypt_failed');
  });

  it('versión o algoritmo desconocidos en la cabecera se rechazan, no se adivinan', async () => {
    const key = await aesKey();
    const env = await seal(key, new Uint8Array(4), PURPOSE.data, 1, 'c');
    const v2 = new Uint8Array(env);
    v2[0] = 2;
    const a2 = new Uint8Array(env);
    a2[1] = 9;
    await expectCode(open(key, v2, PURPOSE.data, 'c'), 'format_unsupported');
    await expectCode(open(key, a2, PURPOSE.data, 'c'), 'format_unsupported');
  });

  it('un keyring bloqueado no cifra ni descifra (D-054, D-082)', async () => {
    const { kr } = await setup();
    const mid = newId();
    const wire = await kr.sealMemory(mid, 1, { a: 1 });
    kr.lock();
    expect(kr.isLocked).toBe(true);
    await expectCode(kr.sealMemory(mid, 1, {}), 'locked');
    await expectCode(kr.openMemory(mid, 1, wire), 'locked');
    await expectCode(kr.sealAsset(newId(), 'photo', null, new Uint8Array(1)), 'locked');
  });

  it('límite conocido (NO cubierto): un rollback a un blob antiguo válido del mismo id SÍ se acepta', async () => {
    const { kr } = await setup();
    const mid = newId();
    const v1 = await kr.sealMemory(mid, 1, { rev: 1 });
    await kr.sealMemory(mid, 1, { rev: 2 });
    expect(await kr.openMemory(mid, 1, v1)).toEqual({ rev: 1 }); // documenta crypto-spec §11.3
  });

  it('contextos: ids mal formados se rechazan antes de cifrar', () => {
    expectCodeSync(() => ctxMemory('x|y', newId(), 1), 'invalid_input');
    expectCodeSync(() => ctxMemory(newId(), newId(), -1), 'invalid_input');
  });
});

describe('clave de recuperación (PS-12, PS-14)', () => {
  const VECTORS: [string, string, number][] = [
    ['ffffffffffffffffffffffffffffffffc0', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZ1W', 0x03c],
    ['000102030405060708090a0b0c0d0e0f10', '000G-40R4-0M30-E209-185G-R38E-1WKS', 0x279],
    ['00112233445566778899aabbccddeeff80', '008J-4CT4-ANK7-F24S-NAXW-SQFE-ZYME', 0x28e],
  ];

  it('reproduce los 3 vectores de crypto-spec §7 (texto y CRC-10)', () => {
    for (const [bytes, key, crc] of VECTORS) {
      const k = recoveryKeyFromBytes(fromHex(bytes));
      expect(k.display).toBe(key);
      expect(crc10(k.ikm)).toBe(crc);
      expect(hex(parseRecoveryKey(key))).toBe(hex(k.ikm)); // ida y vuelta
    }
    expect(recoveryKeyFromBytes(new Uint8Array(17)).display).toBe(
      '0000-0000-0000-0000-0000-0000-0000',
    );
  });

  it('forma: 7 grupos de 4, alfabeto Crockford, 130 bits efectivos (los 6 bits sobrantes valen cero)', () => {
    const k = generateRecoveryKey();
    expect(k.display).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(k.ikm.length).toBe(17);
    expect(k.ikm[16]! & 0x3f).toBe(0);
    expect(new Set(Array.from({ length: 200 }, () => generateRecoveryKey().display)).size).toBe(
      200,
    );
  });

  it('acepta minúsculas, sin guiones, con espacios y O→0, I→1, L→1', () => {
    const k = recoveryKeyFromBytes(fromHex('000102030405060708090a0b0c0d0e0f10')); // 000G-40R4-0M30-E209-185G-R38E-1WKS
    const sloppy = '000g 40r4 0m30 e209 l85g r38e lwks'.replace('0000', 'oooo');
    expect(hex(parseRecoveryKey(sloppy))).toBe(hex(k.ikm));
    expect(normalizeRecoveryInput('oOiIlL')).toBe('001111');
    expect(isRecoveryKeyWellFormed(k.display.replaceAll('-', '').toLowerCase())).toBe(true);
  });

  it('longitud o caracteres imposibles ⇒ recovery_key_format; la U no existe en el alfabeto', () => {
    expectCodeSync(() => parseRecoveryKey('ABCD'), 'recovery_key_format');
    expectCodeSync(() => parseRecoveryKey(VECTORS[1]![1] + 'A'), 'recovery_key_format');
    expectCodeSync(() => parseRecoveryKey('U'.repeat(28)), 'recovery_key_format');
    expectCodeSync(() => parseRecoveryKey('!'.repeat(28)), 'recovery_key_format');
  });

  it('detecta TODAS las sustituciones de un carácter (868) y TODAS las trasposiciones adyacentes en 3 claves', () => {
    const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let n = 0; n < 3; n++) {
      const chars = generateRecoveryKey().display.replaceAll('-', '');
      let subs = 0;
      for (let i = 0; i < 28; i++) {
        for (const c of ALPHA) {
          if (c === chars[i]) continue;
          subs++;
          const typo = chars.slice(0, i) + c + chars.slice(i + 1);
          expectCodeSync(() => parseRecoveryKey(typo), 'recovery_key_checksum');
        }
      }
      expect(subs).toBe(868);
      for (let i = 0; i < 27; i++) {
        if (chars[i] === chars[i + 1]) continue;
        const swapped = chars.slice(0, i) + chars[i + 1] + chars[i] + chars.slice(i + 2);
        expectCodeSync(() => parseRecoveryKey(swapped), 'recovery_key_checksum');
      }
    }
  });

  it('derivación: determinista con la misma sal; distinta con otra sal; auth distinto de kek', async () => {
    const k = generateRecoveryKey();
    const salt = b64uEncode(randomBytes(16));
    const a = await deriveRecoverySecrets(k.ikm, salt);
    const b = await deriveRecoverySecrets(k.ikm, salt);
    const c = await deriveRecoverySecrets(k.ikm, b64uEncode(randomBytes(16)));
    expect(hex(a.auth)).toBe(hex(b.auth));
    expect(hex(a.auth)).not.toBe(hex(c.auth));
    await expectCode(deriveRecoverySecrets(k.ikm, b64uEncode(randomBytes(8))), 'invalid_input');
  });
});

describe('política de contraseña y frase de paso (PS-13)', () => {
  it('rechaza < 14 caracteres, comunes y de poca variedad; acepta buenas y frases', () => {
    expect(checkPasswordPolicy('corta').reasons).toContain('too_short');
    expect(checkPasswordPolicy('1234567890123').ok).toBe(false); // 13
    expect(checkPasswordPolicy('PasswordPassword').reasons).toContain('common');
    expect(checkPasswordPolicy('aaaaaaaaaaaaaaaaaaaa').reasons).toContain('low_variety');
    expect(checkPasswordPolicy('correct horse battery staple').ok).toBe(true);
    expect(checkPasswordPolicy('Xk9#mQ2$vL7!pR4z').ok).toBe(true);
  });
  it('cuenta caracteres por puntos de código tras NFKC (un emoji cuenta 1)', () => {
    expect(checkPasswordPolicy('😀😁😂🤣😃😄😅😆😉😊😋😎😍').reasons).toContain('too_short'); // 13
    expect(checkPasswordPolicy('😀😁😂🤣😃😄😅😆😉😊😋😎😍😘').ok).toBe(true); // 14 distintos
  });
  it('frase de paso: 5 palabras de 7.776 ≈ 64,6 bits; rechaza listas con duplicados', () => {
    const list = Array.from({ length: 7776 }, (_, i) => `w${i}`);
    const p = generatePassphrase(list, 5);
    expect(p.text.split('-')).toHaveLength(5);
    expect(Math.abs(p.entropyBits - 64.62)).toBeLessThan(0.05);
    expectCodeSync(() => generatePassphrase(['a', 'a', 'b']), 'invalid_input');
  });
  it('muestreo por rechazo: un valor sesgado (≥ límite) se descarta y se vuelve a pedir', () => {
    const list = Array.from({ length: 7776 }, (_, i) => `w${i}`);
    const answers: [number, number][] = [
      [0xff, 0xff],
      [0x00, 0x05],
    ]; // 65535 ≥ 62208 → rechazado; 5 → palabra 5
    let call = 0;
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((arr: Uint8Array) => {
      const [a, b] = answers[call++]!;
      arr[0] = a;
      arr[1] = b;
      return arr;
    }) as never);
    expect(generatePassphrase(list, 1).text).toBe('w5');
    expect(call).toBe(2);
  });
});
