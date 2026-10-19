// @vitest-environment node
import { createCipheriv, hkdfSync, pbkdf2Sync, randomBytes as nodeRandom } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromHex, hex } from './_helpers';

/**
 * PS-12 (vectores conocidos) + comprobación de que el entorno de pruebas ofrece Web Crypto.
 * "Verificar que ofrece Web Crypto" = comprobar que las operaciones EXISTEN y que producen los
 * resultados publicados (vectores), no solo que `crypto.subtle` esté definido.
 */
const subtle = globalThis.crypto.subtle;

async function pbkdf2(pw: string, salt: string, iter: number): Promise<string> {
  const k = await subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: iter },
    k,
    256,
  );
  return hex(new Uint8Array(bits));
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  len: number,
): Promise<string> {
  const k = await subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  return hex(
    new Uint8Array(
      await subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
        k,
        len * 8,
      ),
    ),
  );
}

describe('entorno: Web Crypto disponible', () => {
  it('expone crypto.subtle y getRandomValues', () => {
    expect(typeof globalThis.crypto).toBe('object');
    expect(typeof subtle.importKey).toBe('function');
    expect(typeof globalThis.crypto.getRandomValues).toBe('function');
    const a = new Uint8Array(32);
    globalThis.crypto.getRandomValues(a);
    expect(a.some((x) => x !== 0)).toBeTruthy();
  });

  it('PBKDF2-HMAC-SHA256: vectores publicados (password/salt)', async () => {
    expect(await pbkdf2('password', 'salt', 1)).toBe(
      '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b',
    );
    expect(await pbkdf2('password', 'salt', 2)).toBe(
      'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43',
    );
    expect(await pbkdf2('password', 'salt', 4096)).toBe(
      'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a',
    );
  });

  it('PBKDF2-HMAC-SHA256: vectores de RFC 7914 §11 (salida de 64 bytes)', async () => {
    const run = async (pw: string, salt: string, iter: number): Promise<string> => {
      const k = await subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, [
        'deriveBits',
      ]);
      const bits = await subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: iter },
        k,
        512,
      );
      return hex(new Uint8Array(bits));
    };
    expect(await run('passwd', 'salt', 1)).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
    );
    expect(await run('Password', 'NaCl', 80000)).toBe(
      '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d',
    );
  });

  it('PBKDF2: coincide con una segunda implementación (node:crypto) con entradas aleatorias', async () => {
    const pw = nodeRandom(20).toString('base64');
    const salt = nodeRandom(16).toString('base64');
    expect(await pbkdf2(pw, salt, 5000)).toBe(
      pbkdf2Sync(pw, salt, 5000, 32, 'sha256').toString('hex'),
    );
  });

  it('HKDF-SHA256: RFC 5869 casos 1 y 3 (este último con sal e info vacías, como usa el proyecto)', async () => {
    const ikm1 = fromHex('0b'.repeat(22));
    const salt1 = fromHex('000102030405060708090a0b0c');
    const info1 = fromHex('f0f1f2f3f4f5f6f7f8f9');
    expect(await hkdf(ikm1, salt1, info1, 42)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
    const ikm3 = fromHex('0b'.repeat(22));
    expect(await hkdf(ikm3, new Uint8Array(0), new Uint8Array(0), 42)).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    );
  });

  it('HKDF con sal vacía y etiquetas del proyecto coincide con node:crypto', async () => {
    const ikm = nodeRandom(32);
    for (const info of ['mg1/auth/pw', 'mg1/kek/pw', 'mg1/key/data']) {
      const mine = await hkdf(
        new Uint8Array(ikm),
        new Uint8Array(0),
        new TextEncoder().encode(info),
        32,
      );
      expect(mine).toBe(
        Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), info, 32)).toString('hex'),
      );
    }
  });

  it('AES-256-GCM: vector NIST (caso 14: clave y nonce a cero, 16 bytes a cero)', async () => {
    const key = await subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt']);
    const out = new Uint8Array(
      await subtle.encrypt(
        { name: 'AES-GCM', iv: new Uint8Array(12), tagLength: 128 },
        key,
        new Uint8Array(16),
      ),
    );
    expect(hex(out.subarray(0, 16))).toBe('cea7403d4d606b6e074ec5d3baf39d18');
    expect(hex(out.subarray(16))).toBe('d0d1c8a799996bf0265b98b5d48ab919');
  });

  it('AES-GCM con AAD coincide con node:crypto', async () => {
    const raw = nodeRandom(32);
    const iv = nodeRandom(12);
    const aad = Buffer.from('mg1|test|contexto');
    const pt = nodeRandom(100);
    const c = createCipheriv('aes-256-gcm', raw, iv, { authTagLength: 16 });
    c.setAAD(aad);
    const expected = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
    const key = await subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, ['encrypt']);
    const mine = new Uint8Array(
      await subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(iv),
          additionalData: new Uint8Array(aad),
          tagLength: 128,
        },
        key,
        new Uint8Array(pt),
      ),
    );
    expect(hex(mine)).toBe(expected.toString('hex'));
  });
});
