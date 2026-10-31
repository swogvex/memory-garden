/**
 * Restauración desde un `.mgx` (D-100, D-101; privacy-and-backups.md §8.4). El archivo se lee por trozos
 * (`Blob.slice`): nunca se carga entero en memoria.
 *
 * 1. `readBackupHeader`: comprueba el prefijo y lee la cabecera pública (sin claves).
 * 2. `openBackup`: con las claves del espacio (obtenidas de la cabecera con la contraseña o la clave de recuperación),
 *    abre el manifiesto sellado y comprueba que la cabecera, los recuentos y el tamaño del archivo cuadran.
 * 3. `verifyBackup`: recalcula el SHA-256 de cada sobre ANTES de subir nada. Un solo sobre distinto ⇒ `corrupt`.
 * 4. `restoreBackup`: sube lo que falte, con los MISMOS ids (van dentro del AAD). Es reanudable: lo que ya existe en el
 *    espacio (también en la papelera) no se toca, así que repetirlo con el mismo archivo continúa donde se quedó.
 */
import type { Keyring } from '@/lib/crypto';
import { StorageError, type Repository } from '@/lib/storage';
import { parseSettings } from '@/lib/validation';
import { sha256, toBackupError, type BackupProgress } from './export';
import {
  BackupError,
  checkManifest,
  decodePrefix,
  HeaderSchema,
  layout,
  ManifestSchema,
  MAX_MANIFEST_BYTES,
  parseOrFail,
  PREFIX_BYTES,
  readU32,
  type BackupEntry,
  type BackupHeader,
  type BackupManifest,
} from './format';

const decoder = new TextDecoder('utf-8', { fatal: true });

async function slice(file: Blob, start: number, end: number): Promise<Uint8Array> {
  if (end > file.size) throw new BackupError('format');
  let buffer: ArrayBuffer;
  try {
    buffer = await file.slice(start, end).arrayBuffer();
  } catch {
    throw new BackupError('format'); // el archivo ya no se puede leer (se movió o se borró)
  }
  if (buffer.byteLength !== end - start) throw new BackupError('format');
  return new Uint8Array(buffer);
}

function json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new BackupError('format');
  }
}

export interface BackupHead {
  readonly header: BackupHeader;
  /** Bytes exactos de la cabecera: su SHA-256 va dentro del manifiesto. */
  readonly headerBytes: Uint8Array;
  readonly manifestAt: number;
}

export async function readBackupHeader(file: Blob): Promise<BackupHead> {
  if (file.size < PREFIX_BYTES + 4) throw new BackupError('format');
  const h = decodePrefix(await slice(file, 0, PREFIX_BYTES));
  const headerBytes = await slice(file, PREFIX_BYTES, PREFIX_BYTES + h);
  const header = parseOrFail<BackupHeader>(HeaderSchema, json(headerBytes));
  return { header, headerBytes, manifestAt: PREFIX_BYTES + h };
}

export interface OpenedBackup {
  readonly file: Blob;
  readonly header: BackupHeader;
  readonly manifest: BackupManifest;
  readonly offsets: readonly number[];
}

/** Abre el manifiesto con las claves del espacio. `other_space` si las claves son de otro; `corrupt` si no cuadra. */
export async function openBackup(
  file: Blob,
  head: BackupHead,
  keyring: Keyring,
): Promise<OpenedBackup> {
  if (keyring.vaultId !== head.header.vault_id) throw new BackupError('other_space');
  const length = readU32(await slice(file, head.manifestAt, head.manifestAt + 4), 0);
  if (length < 33 || length > MAX_MANIFEST_BYTES) throw new BackupError('format');
  const start = head.manifestAt + 4;
  const sealed = await slice(file, start, start + length);
  let plain: Uint8Array;
  try {
    plain = await keyring.openExport(head.header.export_id, sealed);
  } catch {
    throw new BackupError('corrupt'); // las claves son las buenas (abrieron la envoltura): el manifiesto está alterado
  }
  const manifest = parseOrFail<BackupManifest>(ManifestSchema, json(plain));
  if (manifest.header !== (await sha256(head.headerBytes))) throw new BackupError('corrupt');
  checkManifest(manifest);
  const { offsets, total } = layout(start + length, manifest.entries);
  if (total !== file.size) throw new BackupError('corrupt'); // truncado o con bytes de más
  return { file, header: head.header, manifest, offsets };
}

async function entryBytes(b: OpenedBackup, index: number): Promise<Uint8Array> {
  const e = b.manifest.entries[index];
  const at = b.offsets[index];
  if (!e || at === undefined) throw new BackupError('format');
  const bytes = await slice(b.file, at, at + e.size);
  if ((await sha256(bytes)) !== e.sha256) throw new BackupError('corrupt');
  return bytes;
}

/** Comprueba TODOS los sobres antes de subir nada. */
export async function verifyBackup(
  b: OpenedBackup,
  onProgress?: (p: BackupProgress) => void,
): Promise<void> {
  const total = b.manifest.entries.length;
  for (let i = 0; i < total; i++) {
    await entryBytes(b, i);
    onProgress?.({ phase: 'verify', done: i + 1, total });
  }
}

export interface RestoreSummary {
  /** Recuerdos de la copia. */
  readonly total: number;
  /** Subidos en esta pasada. */
  readonly restored: number;
  /** Ya estaban en el espacio (pasada anterior, o están en la papelera): no se tocan. */
  readonly skipped: number;
  readonly photos: number;
  /** Los ajustes de la copia se aplicaron (solo si el espacio aún no tenía ajustes guardados). */
  readonly settings: boolean;
}

/** Ignora el 409 de un id que ya existe: es nuestra subida de una pasada anterior. */
async function putAssetOnce(repo: Repository, input: Parameters<Repository['assets']['put']>[0]) {
  try {
    await repo.assets.put(input);
  } catch (error) {
    if (!(error instanceof StorageError) || error.code !== 'conflict') throw error;
  }
}

export async function restoreBackup(
  repo: Repository,
  keyring: Keyring,
  b: OpenedBackup,
  onProgress?: (p: BackupProgress) => void,
): Promise<RestoreSummary> {
  if (keyring.vaultId !== b.header.vault_id) throw new BackupError('other_space');
  const entries = b.manifest.entries;
  const mk = keyring.mkVersion;
  try {
    const existing = new Set((await repo.memories.list({ includeTrashed: true })).map((r) => r.id));
    const total = b.manifest.counts.memories;
    let done = 0;
    let restored = 0;
    let skipped = 0;
    let photos = 0;
    let settingsApplied = false;
    onProgress?.({ phase: 'upload', done, total });

    // Ajustes y avatar: solo en un espacio que todavía no tiene ajustes (no se pisa lo que ya se haya cambiado).
    const stored = await repo.vault.getSettings();
    const si = entries.findIndex((e) => e.t === 'settings');
    const settingsEntry = entries[si];
    if (stored.revision === 0 && settingsEntry?.t === 'settings') {
      const ai = entries.findIndex((e) => e.t === 'avatar');
      const avatar = entries[ai];
      if (avatar?.t === 'avatar')
        await putAssetOnce(repo, {
          id: avatar.id,
          kind: 'avatar',
          parentId: null,
          mkVersion: mk,
          bytes: await entryBytes(b, ai),
        });
      let value;
      try {
        value = parseSettings(
          await keyring.openSettings(settingsEntry.rev, decoder.decode(await entryBytes(b, si))),
        );
      } catch (error) {
        if (error instanceof BackupError) throw error;
        throw new BackupError('corrupt');
      }
      // El AAD de los ajustes lleva la revisión: en el espacio nuevo es la 1, así que se vuelven a cifrar (mismo contenido).
      try {
        await repo.vault.putSettings(await keyring.sealSettings(1, value), 0);
        settingsApplied = true;
      } catch (error) {
        if (!(error instanceof StorageError) || error.code !== 'conflict') throw error;
      }
    }

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i] as BackupEntry;
      if (e.t !== 'memory') continue;
      const own: number[] = [];
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[j] as BackupEntry;
        if ((a.t === 'photo' || a.t === 'thumb') && a.memory === e.id) own.push(j);
        else break;
      }
      if (existing.has(e.id)) {
        skipped++;
      } else {
        const assetIds: string[] = [];
        for (const j of own) {
          const a = entries[j] as Extract<BackupEntry, { t: 'photo' | 'thumb' }>;
          await putAssetOnce(repo, {
            id: a.id,
            kind: a.t,
            parentId: a.t === 'thumb' ? a.parent : null,
            mkVersion: mk,
            bytes: await entryBytes(b, j),
          });
          assetIds.push(a.id);
        }
        try {
          await repo.memories.put(
            {
              id: e.id,
              payload: decoder.decode(await entryBytes(b, i)),
              schemaVersion: e.sv,
              mkVersion: mk,
              assetIds,
            },
            null,
          );
        } catch (error) {
          // Ya existe: se creó entre la lista y ahora (otra pestaña con la misma copia). No es un fallo.
          if (!(error instanceof StorageError) || error.code !== 'conflict') throw error;
        }
        restored++;
        photos += own.filter((j) => entries[j]?.t === 'photo').length;
      }
      done++;
      onProgress?.({ phase: 'upload', done, total });
    }
    return { total, restored, skipped, photos, settings: settingsApplied };
  } catch (error) {
    throw toBackupError(error);
  }
}
