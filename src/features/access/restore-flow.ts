/**
 * Restaurar un espacio desde una copia `.mgx` (H8.3; privacy-and-backups.md §8.4, D-100, D-101).
 * Solo sobre un espacio VACÍO y con el código de configuración: es un primer acceso que, en vez de generar una clave
 * maestra nueva, reutiliza la del archivo (los ids y el AAD de cada sobre dependen de ella y del id del espacio).
 *
 * - Con la contraseña: se conserva esa contraseña (misma envoltura) y se genera una clave de recuperación NUEVA
 *   (la de recuperación no se puede rehacer sin la clave antigua, que no se pide).
 * - Con la clave de recuperación: se da por expuesta (como en §8.4) y se crean contraseña nueva y clave nueva.
 *
 * Nada se envía hasta `submit`. La contraseña, la clave y la clave maestra no salen nunca del dispositivo.
 */
import {
  disposeMaterial,
  prepareRecovery,
  preparePassword,
  regenerateRecoveryKey,
  resetViaRecovery,
  unwrapWithPassword,
  unwrapWithRecovery,
  type Keyring,
  type PasswordMaterial,
  type RecoveryMaterial,
  type VaultWire,
} from '@/lib/crypto';
import {
  BackupError,
  openBackup,
  readBackupHeader,
  restoreBackup,
  verifyBackup,
  type BackupHead,
  type BackupManifest,
  type BackupProgress,
  type OpenedBackup,
  type RestoreSummary,
} from '@/lib/backup';
import { createRemoteRepository } from '@/lib/remote/remote-repository';
import { AccessError, fromAuth, type Tuning } from './access-flow';
import type { AuthClient, SetupRequest } from './auth-client';
import { commonPasswordsOrNull } from './common-list';
import { passwordIssues, recoveryInputState } from './setup-model';

export interface PendingRestore {
  /** Clave de recuperación NUEVA: mostrar una vez y exigir que se reescriba ANTES de `submit`. */
  readonly recoveryKey: string;
  /** Crea el espacio con la clave maestra del archivo. Reintentable si falla la red. */
  submit(setupCode: string): Promise<Keyring>;
  discard(): void;
}

export interface BackupUnlock {
  readonly mode: 'password' | 'recovery';
  /** Manifiesto ya comprobado (no es secreto: ids, tamaños y hashes de sobres cifrados). */
  readonly backup: OpenedBackup;
  readonly counts: BackupManifest['counts'];
  /** Con la clave de recuperación hace falta `newPassword`; con la contraseña se ignora. */
  prepare(newPassword?: string): Promise<PendingRestore>;
  discard(): void;
}

function wireOf(head: BackupHead): VaultWire {
  const h = head.header;
  return {
    vaultId: h.vault_id,
    kdf: h.kdf,
    mkVersion: h.mk_version,
    wrappedMkPw: h.wrapped_mk_pw,
    recSalt: h.rec_salt,
    wrappedMkRec: h.wrapped_mk_rec,
  };
}

/** Alta en el servidor con respuesta perdida reconocida, como el primer acceso normal. */
function pendingFrom(
  client: AuthClient,
  request: Omit<SetupRequest, 'setupCode'>,
  recoveryKey: string,
  ready: Keyring,
): PendingRestore {
  let keyring: Keyring | null = ready;
  let lostResponse = false;
  return {
    recoveryKey,
    async submit(setupCode) {
      if (!keyring) throw new AccessError('unavailable');
      try {
        await client.setup({ ...request, setupCode });
      } catch (error) {
        const failure = fromAuth(error, 'setup_rejected');
        if (failure.code === 'unavailable') lostResponse = true;
        if (failure.code !== 'setup_rejected' || !lostResponse) throw failure;
        try {
          await client.login(request.authPw); // si entra con ESTA prueba, el alta anterior era la nuestra
        } catch {
          throw failure;
        }
      }
      const out = keyring;
      keyring = null;
      return out;
    },
    discard() {
      keyring?.lock();
      keyring = null;
    },
  };
}

/** Lee la cabecera, abre la clave maestra con la contraseña y comprueba el manifiesto y cada sobre. No envía nada. */
export async function openBackupWithPassword(
  client: AuthClient,
  file: Blob,
  password: string,
  tuning: Tuning = {},
  onProgress?: (p: BackupProgress) => void,
): Promise<BackupUnlock> {
  const head = await readBackupHeader(file);
  const wire = wireOf(head);
  let material: PasswordMaterial;
  try {
    material = await preparePassword(password, wire.kdf, tuning.vault?.policy);
  } catch {
    throw new AccessError('insecure_params');
  }
  let keyring: Keyring;
  try {
    keyring = await unwrapWithPassword(material, wire);
  } catch {
    disposeMaterial(material);
    throw new BackupError('credentials');
  }
  let backup: OpenedBackup;
  try {
    backup = await openBackup(file, head, keyring);
    await verifyBackup(backup, onProgress); // todos los sobres, ANTES de crear nada en el servidor
  } catch (error) {
    keyring.lock();
    disposeMaterial(material);
    throw error;
  }
  let live: PasswordMaterial | null = material;
  const release = () => {
    if (live) disposeMaterial(live);
    live = null;
  };
  return {
    mode: 'password',
    backup,
    counts: backup.manifest.counts,
    async prepare() {
      if (!live) throw new AccessError('unavailable');
      let rec;
      try {
        rec = await regenerateRecoveryKey(live, wire);
      } catch {
        throw new AccessError('unwrap_failed');
      }
      const request = {
        vaultId: wire.vaultId,
        kdf: wire.kdf,
        authPw: live.authPw,
        recSalt: rec.recSalt,
        authRec: rec.authRec,
        wrappedMkPw: wire.wrappedMkPw,
        wrappedMkRec: rec.wrappedMkRec,
        mkVersion: wire.mkVersion,
      };
      release();
      return pendingFrom(client, request, rec.recoveryKey, keyring);
    },
    discard() {
      release();
      keyring.lock();
    },
  };
}

/** Igual, con la clave de recuperación; `prepare` exige la contraseña nueva. */
export async function openBackupWithRecoveryKey(
  client: AuthClient,
  file: Blob,
  keyInput: string,
  tuning: Tuning = {},
  onProgress?: (p: BackupProgress) => void,
): Promise<BackupUnlock> {
  const state = recoveryInputState(keyInput);
  if (state === 'checksum') throw new AccessError('key_checksum');
  if (state !== 'ok') throw new AccessError('key_format');
  const head = await readBackupHeader(file);
  const wire = wireOf(head);
  let material: RecoveryMaterial;
  try {
    material = await prepareRecovery(keyInput, wire.recSalt);
  } catch {
    throw new AccessError('key_format');
  }
  let keyring: Keyring;
  try {
    keyring = await unwrapWithRecovery(material, wire);
  } catch {
    disposeMaterial(material);
    throw new BackupError('credentials');
  }
  let backup: OpenedBackup;
  try {
    backup = await openBackup(file, head, keyring);
    await verifyBackup(backup, onProgress); // todos los sobres, ANTES de crear nada en el servidor
  } catch (error) {
    keyring.lock();
    disposeMaterial(material);
    throw error;
  }
  let live: RecoveryMaterial | null = material;
  const release = () => {
    if (live) disposeMaterial(live);
    live = null;
  };
  return {
    mode: 'recovery',
    backup,
    counts: backup.manifest.counts,
    async prepare(newPassword = '') {
      if (!live) throw new AccessError('unavailable');
      if (passwordIssues(newPassword, undefined, await commonPasswordsOrNull()).length > 0)
        throw new AccessError('policy');
      let reset;
      try {
        reset = await resetViaRecovery(live, wire, newPassword, tuning.vault);
      } catch {
        throw new AccessError('unwrap_failed');
      }
      reset.keyring.lock(); // ya hay unas claves abiertas para este espacio: estas sobran
      const request = {
        vaultId: wire.vaultId,
        kdf: reset.kdf,
        authPw: reset.authPw,
        recSalt: reset.recSalt,
        authRec: reset.authRec,
        wrappedMkPw: reset.wrappedMkPw,
        wrappedMkRec: reset.wrappedMkRec,
        mkVersion: wire.mkVersion,
      };
      release();
      return pendingFrom(client, request, reset.recoveryKey, keyring);
    },
    discard() {
      release();
      keyring.lock();
    },
  };
}

/** Sube la copia (ya comprobada) al espacio recién creado. Cada sobre se vuelve a comprobar al leerlo. `fetch`: pruebas. */
export function uploadBackup(
  keyring: Keyring,
  backup: OpenedBackup,
  onProgress?: (p: BackupProgress) => void,
  fetch?: typeof globalThis.fetch,
): Promise<RestoreSummary> {
  const repo = createRemoteRepository(fetch ? { fetch } : {});
  return restoreBackup(repo, keyring, backup, onProgress);
}
