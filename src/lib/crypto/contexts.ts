import { CryptoError } from './errors';
import { isId } from './ids';

/** Cadenas de contexto EXACTAS de crypto-spec.md §5.3 (van en el AAD). */

function needId(s: string): string {
  if (!isId(s)) throw new CryptoError('invalid_input');
  return s;
}
function needInt(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new CryptoError('invalid_input');
  return n;
}
function needKind(k: string): string {
  if (k !== 'photo' && k !== 'thumb' && k !== 'avatar') throw new CryptoError('invalid_input');
  return k;
}

export const ctxMemory = (vaultId: string, memoryId: string, schemaVersion: number): string =>
  `mg1|memory|${needId(vaultId)}|${needId(memoryId)}|${needInt(schemaVersion)}`;

export const ctxSettings = (vaultId: string, settingsRevision: number): string =>
  `mg1|settings|${needId(vaultId)}|${needInt(settingsRevision)}`;

export const ctxAsset = (
  vaultId: string,
  assetId: string,
  kind: string,
  memoryId: string | null,
): string =>
  `mg1|asset|${needId(vaultId)}|${needId(assetId)}|${needKind(kind)}|${memoryId === null ? '-' : needId(memoryId)}`;

/** `kdfCanonical` ya validado por parseKdf (JSON canónico). */
export const ctxWrapPw = (vaultId: string, kdfCanonical: string): string =>
  `mg1|wrap-pw|${needId(vaultId)}|${kdfCanonical}`;

export const ctxWrapRec = (vaultId: string, recSalt: string): string =>
  `mg1|wrap-rec|${needId(vaultId)}|${needId(recSalt)}`;

export const ctxExport = (vaultId: string, exportId: string): string =>
  `mg1|export|${needId(vaultId)}|${needId(exportId)}`;
