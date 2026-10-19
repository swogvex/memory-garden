import { CryptoError } from '../../src/lib/crypto/errors';
import type { CryptoErrorCode } from '../../src/lib/crypto/errors';
import type { KdfPolicy } from '../../src/lib/crypto/constants';

/** Política SOLO de pruebas: iteraciones bajas para que la suite sea rápida. Producción usa PRODUCTION_KDF_POLICY. */
export const TEST_POLICY: KdfPolicy = {
  minIter: 1000,
  maxIter: 10_000_000,
  targetIter: 1000,
  algs: ['pbkdf2-sha256'],
};

export const PW = 'correct horse battery staple';
export const PW2 = 'otra frase larga y distinta 2026';

export const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (s: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(s, 'hex'));

/** Comprueba que la promesa falla con CryptoError del código dado. */
export async function expectCode(p: Promise<unknown>, code: CryptoErrorCode): Promise<void> {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  if (!(err instanceof CryptoError))
    throw new Error(`se esperaba CryptoError(${code}) y se obtuvo ${String(err)}`);
  if (err.code !== code) throw new Error(`se esperaba ${code} y se obtuvo ${err.code}`);
}

export function expectCodeSync(fn: () => unknown, code: CryptoErrorCode): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof CryptoError && e.code === code) return;
    throw new Error(`se esperaba ${code} y se obtuvo ${String(e)}`, { cause: e });
  }
  throw new Error(`se esperaba CryptoError(${code}) y no hubo error`);
}
