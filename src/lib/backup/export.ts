/**
 * Exportación cifrada (D-100): TODO se hace en este navegador con la sesión desbloqueada; el servidor solo sirve los
 * sobres cifrados que ya guarda y no sabe que se está haciendo una copia.
 *
 * Qué va en el archivo: la envoltura del espacio (las dos: contraseña y clave de recuperación), los ajustes, el avatar y
 * cada recuerdo VISIBLE con sus fotos y miniaturas, todo TAL CUAL está cifrado. No van los recuerdos de la papelera.
 * Las fotos que se enumeran son las que nombra cada recuerdo (por eso se abre cada uno); un recuerdo que no se puede abrir
 * se copia igualmente, sin fotos, y se cuenta en `unreadable`.
 */
import { b64uEncode, newId, type Keyring } from '@/lib/crypto';
import { StorageError, type Repository } from '@/lib/storage';
import { parseMemoryPayload, parseSettings } from '@/lib/validation';
import {
  BackupError,
  encodePrefix,
  MGX_VERSION,
  u32,
  type BackupEntry,
  type BackupHeader,
  type BackupManifest,
} from './format';

export interface BackupProgress {
  readonly phase: 'read' | 'verify' | 'upload';
  readonly done: number;
  readonly total: number;
}

export interface ExportSummary {
  readonly memories: number;
  readonly photos: number;
  /** Fotos que el servidor ya no tenía: no van en el archivo. */
  readonly missing: number;
  /** Recuerdos que no se pudieron abrir: van tal cual, sin fotos. */
  readonly unreadable: number;
  readonly bytes: number;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly fileName: string;
  readonly summary: ExportSummary;
}

const encoder = new TextEncoder();

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return b64uEncode(new Uint8Array(digest));
}

function toBackupError(error: unknown): BackupError {
  if (error instanceof BackupError) return error;
  if (error instanceof StorageError && (error.code === 'quota' || error.code === 'too_large'))
    return new BackupError('quota');
  return new BackupError('unavailable');
}

/** `memory-garden-AAAA-MM-DD.mgx` con la fecha del dispositivo. */
export function exportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `memory-garden-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.mgx`;
}

/** Entrada del manifiesto antes de conocer su tamaño y su hash. */
type PlanEntry = BackupEntry extends infer E
  ? E extends BackupEntry
    ? Omit<E, 'size' | 'sha256'>
    : never
  : never;
/** `bytes = null`: sobre de R2 que hay que descargar. */
interface Planned {
  readonly entry: PlanEntry;
  readonly bytes: Uint8Array | null;
}

export interface ExportOptions {
  readonly now?: Date;
  readonly onProgress?: (p: BackupProgress) => void;
}

export async function exportSpace(
  repo: Repository,
  keyring: Keyring,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const now = options.now ?? new Date();
  try {
    const vault = await repo.vault.get();
    if (!vault || vault.id !== keyring.vaultId) throw new BackupError('unavailable');
    const records = await repo.memories.list();

    const plan: Planned[] = [];
    let unreadable = 0;

    if (vault.settingsPayload !== null) {
      plan.push({
        entry: { t: 'settings', rev: vault.settingsRevision },
        bytes: encoder.encode(vault.settingsPayload),
      });
      try {
        const settings = parseSettings(
          await keyring.openSettings(vault.settingsRevision, vault.settingsPayload),
        );
        if (settings.avatar?.kind === 'asset')
          plan.push({ entry: { t: 'avatar', id: settings.avatar.assetId }, bytes: null });
      } catch {
        // Ajustes que no se abren: se copian tal cual, sin avatar.
      }
    }

    for (const r of records) {
      plan.push({
        entry: { t: 'memory', id: r.id, sv: r.schemaVersion },
        bytes: encoder.encode(r.payload),
      });
      let photos: { assetId: string; thumbId: string }[] = [];
      try {
        photos = parseMemoryPayload(
          await keyring.openMemory(r.id, r.schemaVersion, r.payload),
        ).photos;
      } catch {
        unreadable++;
      }
      for (const p of photos) {
        plan.push({ entry: { t: 'photo', id: p.assetId, memory: r.id }, bytes: null });
        plan.push({
          entry: { t: 'thumb', id: p.thumbId, memory: r.id, parent: p.assetId },
          bytes: null,
        });
      }
    }

    const total = plan.filter((p) => p.bytes === null).length;
    let done = 0;
    options.onProgress?.({ phase: 'read', done, total });

    const entries: BackupEntry[] = [];
    const parts: Uint8Array[] = [];
    const missingPhotos = new Set<string>();
    let photos = 0;

    for (const item of plan) {
      let data = item.bytes;
      if (data === null) {
        const e = item.entry;
        if (e.t === 'settings' || e.t === 'memory') continue; // no ocurre: estos llevan sus bytes
        // Sin la foto, su miniatura no tiene a quién colgarse: se omite también.
        data = e.t === 'thumb' && missingPhotos.has(e.parent) ? null : await fetchAsset(repo, e.id);
        done++;
        options.onProgress?.({ phase: 'read', done, total });
        if (data === null) {
          if (e.t === 'photo') missingPhotos.add(e.id);
          continue;
        }
        if (e.t === 'photo') photos++;
      }
      entries.push({ ...item.entry, size: data.length, sha256: await sha256(data) } as BackupEntry);
      parts.push(data);
    }

    const exportId = newId();
    const header: BackupHeader = {
      format: MGX_VERSION,
      vault_id: vault.id,
      mk_version: vault.mkVersion,
      kdf: vault.kdf,
      wrapped_mk_pw: vault.wrappedMkPw,
      rec_salt: vault.recSalt,
      wrapped_mk_rec: vault.wrappedMkRec,
      export_id: exportId,
    };
    const headerBytes = encoder.encode(JSON.stringify(header));
    const manifest: BackupManifest = {
      v: MGX_VERSION,
      header: await sha256(headerBytes),
      created: now.toISOString(),
      counts: { memories: records.length, photos, missing: missingPhotos.size, unreadable },
      entries,
    };
    const sealed = await keyring.sealExport(exportId, encoder.encode(JSON.stringify(manifest)));
    const fileParts = [
      encodePrefix(headerBytes.length),
      headerBytes,
      u32(sealed.length),
      sealed,
      ...parts,
    ];
    const blob = new Blob(fileParts as BlobPart[], { type: 'application/octet-stream' });
    return {
      blob,
      fileName: exportFileName(now),
      summary: {
        memories: records.length,
        photos,
        missing: missingPhotos.size,
        unreadable,
        bytes: blob.size,
      },
    };
  } catch (error) {
    throw toBackupError(error);
  }
}

/** Un sobre de R2. `null` si el servidor ya no lo tiene. Un fallo de red se reintenta una vez. */
async function fetchAsset(repo: Repository, id: string): Promise<Uint8Array | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await repo.assets.getBytes(id);
    } catch (error) {
      if (error instanceof StorageError && error.code === 'not_found') return null;
      if (attempt >= 1 || !(error instanceof StorageError) || error.code !== 'unavailable')
        throw error;
    }
  }
}

export { toBackupError };
