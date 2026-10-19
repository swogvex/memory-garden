import { b64uDecode, b64uEncode, fromUtf8, utf8, zero } from './bytes';
import type { Bytes } from './bytes';
import { INFO, PURPOSE } from './constants';
import { ctxAsset, ctxExport, ctxMemory, ctxSettings } from './contexts';
import { open, seal } from './envelope';
import { CryptoError } from './errors';
import { pad, unpad } from './padding';

/** Subclaves del espacio, en memoria y no extraíbles. `lock()` suelta las referencias (D-054, D-082). */
export class Keyring {
  readonly vaultId: string;
  readonly mkVersion: number;
  #data: CryptoKey | null;
  #asset: CryptoKey | null;
  #export: CryptoKey | null;

  private constructor(
    vaultId: string,
    mkVersion: number,
    data: CryptoKey,
    asset: CryptoKey,
    exp: CryptoKey,
  ) {
    this.vaultId = vaultId;
    this.mkVersion = mkVersion;
    this.#data = data;
    this.#asset = asset;
    this.#export = exp;
  }

  /** Importa la MK como material HKDF NO extraíble y deriva K_data, K_asset, K_export (§3). El llamador pone `mk` a cero. */
  static async fromMasterKey(mk: Uint8Array, vaultId: string, mkVersion: number): Promise<Keyring> {
    const subtle = globalThis.crypto.subtle;
    const base = await subtle.importKey('raw', mk as BufferSource, 'HKDF', false, ['deriveKey']);
    const derive = (info: string): Promise<CryptoKey> =>
      subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    const [d, a, e] = await Promise.all([
      derive(INFO.keyData),
      derive(INFO.keyAsset),
      derive(INFO.keyExport),
    ]);
    return new Keyring(vaultId, mkVersion, d, a, e);
  }

  get isLocked(): boolean {
    return this.#data === null;
  }

  lock(): void {
    this.#data = null;
    this.#asset = null;
    this.#export = null;
  }

  #k(which: '#data' | '#asset' | '#export'): CryptoKey {
    const k = which === '#data' ? this.#data : which === '#asset' ? this.#asset : this.#export;
    if (k === null) throw new CryptoError('locked');
    return k;
  }

  async #sealJson(
    key: CryptoKey,
    purpose: typeof PURPOSE.data,
    context: string,
    value: unknown,
  ): Promise<string> {
    const json = JSON.stringify(value);
    if (json === undefined) throw new CryptoError('invalid_input');
    const plain = pad(utf8(json));
    try {
      return b64uEncode(await seal(key, plain, purpose, this.mkVersion, context));
    } finally {
      zero(plain);
    }
  }

  async #openJson(
    key: CryptoKey,
    purpose: typeof PURPOSE.data,
    context: string,
    wire: string,
  ): Promise<unknown> {
    const { plaintext, mkVersion } = await open(key, b64uDecode(wire), purpose, context);
    try {
      if (mkVersion !== this.mkVersion) throw new CryptoError('format_unsupported');
      return JSON.parse(fromUtf8(unpad(plaintext)));
    } catch (e) {
      if (e instanceof CryptoError) throw e;
      throw new CryptoError('decrypt_failed');
    } finally {
      zero(plaintext);
    }
  }

  /** Recuerdo → envoltorio base64url (lo que va a `memory.payload`). Relleno en cubos. */
  async sealMemory(memoryId: string, schemaVersion: number, value: unknown): Promise<string> {
    return this.#sealJson(
      this.#k('#data'),
      PURPOSE.data,
      ctxMemory(this.vaultId, memoryId, schemaVersion),
      value,
    );
  }
  async openMemory(memoryId: string, schemaVersion: number, wire: string): Promise<unknown> {
    return this.#openJson(
      this.#k('#data'),
      PURPOSE.data,
      ctxMemory(this.vaultId, memoryId, schemaVersion),
      wire,
    );
  }

  /** `revision` = la que tendrá el documento TRAS guardarse (expected + 1). */
  async sealSettings(revision: number, value: unknown): Promise<string> {
    return this.#sealJson(
      this.#k('#data'),
      PURPOSE.data,
      ctxSettings(this.vaultId, revision),
      value,
    );
  }
  async openSettings(revision: number, wire: string): Promise<unknown> {
    return this.#openJson(
      this.#k('#data'),
      PURPOSE.data,
      ctxSettings(this.vaultId, revision),
      wire,
    );
  }

  /** Fotos/miniaturas/avatar: binario puro para R2; SIN relleno (§5.5). */
  async sealAsset(
    assetId: string,
    kind: string,
    memoryId: string | null,
    bytes: Uint8Array,
  ): Promise<Bytes> {
    return seal(
      this.#k('#asset'),
      bytes,
      PURPOSE.asset,
      this.mkVersion,
      ctxAsset(this.vaultId, assetId, kind, memoryId),
    );
  }
  async openAsset(
    assetId: string,
    kind: string,
    memoryId: string | null,
    envelope: Uint8Array,
  ): Promise<Bytes> {
    const { plaintext, mkVersion } = await open(
      this.#k('#asset'),
      envelope,
      PURPOSE.asset,
      ctxAsset(this.vaultId, assetId, kind, memoryId),
    );
    if (mkVersion !== this.mkVersion) throw new CryptoError('format_unsupported');
    return plaintext;
  }

  async sealExport(exportId: string, bytes: Uint8Array): Promise<Bytes> {
    return seal(
      this.#k('#export'),
      bytes,
      PURPOSE.export,
      this.mkVersion,
      ctxExport(this.vaultId, exportId),
    );
  }
  async openExport(exportId: string, envelope: Uint8Array): Promise<Bytes> {
    const { plaintext, mkVersion } = await open(
      this.#k('#export'),
      envelope,
      PURPOSE.export,
      ctxExport(this.vaultId, exportId),
    );
    if (mkVersion !== this.mkVersion) throw new CryptoError('format_unsupported');
    return plaintext;
  }
}
