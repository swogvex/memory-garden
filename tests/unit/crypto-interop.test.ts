// @vitest-environment node
import { createCipheriv, createDecipheriv, hkdfSync, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { b64uDecode, b64uEncode } from '../../src/lib/crypto/bytes';
import { canonicalKdf } from '../../src/lib/crypto/kdf';
import { recoveryKeyFromBytes } from '../../src/lib/crypto/recovery-key';
import {
  prepareRecovery,
  preparePassword,
  unwrapWithPassword,
  unwrapWithRecovery,
} from '../../src/lib/crypto/vault';
import type { VaultWire } from '../../src/lib/crypto/vault';
import { PW, TEST_POLICY } from './_helpers';

/**
 * Interoperabilidad con una SEGUNDA implementación (node:crypto / OpenSSL, escrita aparte a partir de crypto-spec.md):
 * un espacio construido a mano —contraseña → PBKDF2 → HKDF → envoltura → subclave de datos → recuerdo— se abre con
 * lib/crypto, y lo que cifra lib/crypto se abre con la implementación de referencia. Atrapa errores de etiquetas HKDF,
 * hash, número de iteraciones, normalización, orden de la cabecera, AAD y relleno que una prueba de ida y vuelta
 * (que usa el mismo código para cifrar y descifrar) no ve.
 */
const seq = (n: number, f: (i: number) => number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => f(i) & 0xff);
const VAULT_ID = b64uEncode(seq(16, (i) => i + 1));
const MEM_ID = b64uEncode(seq(16, (i) => 101 + i));
const SALT = seq(16, (i) => 0xa0 + i);
const REC_SALT = seq(16, (i) => 0x40 + i);
const MK = seq(32, (i) => i * 7 + 3);
const REC_BYTES = seq(17, (i) => 0x11 * (i + 1));
const EMPTY = new Uint8Array(0);
const nonce = (n: number): Uint8Array => seq(12, (i) => n * 16 + i);
const hk = (ikm: Uint8Array, salt: Uint8Array, info: string): Uint8Array =>
  new Uint8Array(hkdfSync('sha256', ikm, salt, info, 32));

function gcm(
  key: Uint8Array,
  iv: Uint8Array,
  header: number[],
  context: string,
  plain: Uint8Array,
): Uint8Array {
  const h = Buffer.from(header);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.concat([h, Buffer.from(context, 'utf8')]));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return new Uint8Array(Buffer.concat([h, iv, ct, c.getAuthTag()]));
}

function paddedJson(value: unknown, bucket: number): Uint8Array {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const out = Buffer.alloc(bucket);
  out.writeUInt32BE(body.length, 0);
  body.copy(out, 4);
  return new Uint8Array(out);
}

const KDF = canonicalKdf({ v: 1, alg: 'pbkdf2-sha256', iter: 1000, salt: b64uEncode(SALT) });
const PW_KEY = new Uint8Array(pbkdf2Sync(PW.normalize('NFKC'), SALT, 1000, 32, 'sha256'));
const DATA_KEY = hk(MK, EMPTY, 'mg1/key/data');
const REC = recoveryKeyFromBytes(REC_BYTES);

const WIRE: VaultWire = {
  vaultId: VAULT_ID,
  kdf: KDF,
  mkVersion: 1,
  wrappedMkPw: b64uEncode(
    gcm(
      hk(PW_KEY, EMPTY, 'mg1/kek/pw'),
      nonce(1),
      [1, 1, 0x10, 0],
      `mg1|wrap-pw|${VAULT_ID}|${KDF}`,
      MK,
    ),
  ),
  recSalt: b64uEncode(REC_SALT),
  wrappedMkRec: b64uEncode(
    gcm(
      hk(REC.ikm, REC_SALT, 'mg1/kek/rec'),
      nonce(3),
      [1, 1, 0x11, 0],
      `mg1|wrap-rec|${VAULT_ID}|${b64uEncode(REC_SALT)}`,
      MK,
    ),
  ),
};
const VALUE = { title: 'Interop', texto: 'ñandú ✓' };
const BLOB = b64uEncode(
  gcm(
    DATA_KEY,
    nonce(2),
    [1, 1, 1, 1],
    `mg1|memory|${VAULT_ID}|${MEM_ID}|1`,
    paddedJson(VALUE, 1024),
  ),
);

describe('interoperabilidad con una segunda implementación (node:crypto)', () => {
  it('contraseña: el secreto de autenticación y la envoltura construidos a mano coinciden y abren el recuerdo', async () => {
    const m = await preparePassword(PW, KDF, TEST_POLICY);
    expect(m.authPw).toBe(b64uEncode(hk(PW_KEY, EMPTY, 'mg1/auth/pw')));
    const ring = await unwrapWithPassword(m, WIRE);
    expect(await ring.openMemory(MEM_ID, 1, BLOB)).toEqual(VALUE);
  });

  it('recuperación: el secreto de autenticación y la envoltura construidos a mano coinciden y abren el mismo recuerdo', async () => {
    const m = await prepareRecovery(REC.display, WIRE.recSalt);
    expect(m.authRec).toBe(b64uEncode(hk(REC.ikm, REC_SALT, 'mg1/auth/rec')));
    const ring = await unwrapWithRecovery(m, WIRE);
    expect(await ring.openMemory(MEM_ID, 1, BLOB)).toEqual(VALUE);
  });

  it('en sentido contrario: lo que cifra lib/crypto lo abre la implementación de referencia (cabecera, AAD, relleno)', async () => {
    const ring = await unwrapWithPassword(await preparePassword(PW, KDF, TEST_POLICY), WIRE);
    const env = b64uDecode(await ring.sealMemory(MEM_ID, 1, VALUE));
    expect(Array.from(env.subarray(0, 4))).toEqual([1, 1, 1, 1]);
    expect(env.length).toBe(4 + 12 + 1024 + 16); // cubo de 1 KiB + cabecera + nonce + etiqueta
    const d = createDecipheriv('aes-256-gcm', DATA_KEY, env.subarray(4, 16));
    d.setAAD(
      Buffer.concat([
        Buffer.from(env.subarray(0, 4)),
        Buffer.from(`mg1|memory|${VAULT_ID}|${MEM_ID}|1`, 'utf8'),
      ]),
    );
    d.setAuthTag(Buffer.from(env.subarray(env.length - 16)));
    const plain = Buffer.concat([d.update(env.subarray(16, env.length - 16)), d.final()]);
    const len = plain.readUInt32BE(0);
    expect(JSON.parse(plain.subarray(4, 4 + len).toString('utf8'))).toEqual(VALUE);
    expect(plain.subarray(4 + len).every((x) => x === 0)).toBeTruthy();
  });

  it('subclaves de recursos y de exportación: etiquetas HKDF propias y finalidad en la cabecera', async () => {
    const ring = await unwrapWithPassword(await preparePassword(PW, KDF, TEST_POLICY), WIRE);
    const assetId = b64uEncode(seq(16, (i) => 201 + i));
    const exportId = b64uEncode(seq(16, (i) => 31 + i));
    const bytes = seq(100, (i) => i * 3);
    const openRef = (
      key: Uint8Array,
      env: Uint8Array,
      header: number[],
      context: string,
    ): Buffer => {
      expect(Array.from(env.subarray(0, 4))).toEqual(header);
      const d = createDecipheriv('aes-256-gcm', key, env.subarray(4, 16));
      d.setAAD(Buffer.concat([Buffer.from(env.subarray(0, 4)), Buffer.from(context, 'utf8')]));
      d.setAuthTag(Buffer.from(env.subarray(env.length - 16)));
      return Buffer.concat([d.update(env.subarray(16, env.length - 16)), d.final()]);
    };
    const asset = await ring.sealAsset(assetId, 'photo', MEM_ID, bytes);
    expect(asset.length).toBe(4 + 12 + 100 + 16); // sin relleno
    expect(
      new Uint8Array(
        openRef(
          hk(MK, EMPTY, 'mg1/key/asset'),
          asset,
          [1, 1, 2, 1],
          `mg1|asset|${VAULT_ID}|${assetId}|photo|${MEM_ID}`,
        ),
      ),
    ).toEqual(bytes);
    const exp = await ring.sealExport(exportId, bytes);
    expect(
      new Uint8Array(
        openRef(
          hk(MK, EMPTY, 'mg1/key/export'),
          exp,
          [1, 1, 3, 1],
          `mg1|export|${VAULT_ID}|${exportId}`,
        ),
      ),
    ).toEqual(bytes);
  });
});
