/**
 * Puerto de datos de «Tus datos» en Configuración: exportar el espacio desbloqueado y continuar una restauración
 * con el mismo archivo. La restauración inicial (espacio vacío) va por el asistente de la pantalla de acceso.
 */
import type { Keyring } from '@/lib/crypto';
import type { Repository } from '@/lib/storage';
import { exportSpace, type BackupProgress, type ExportResult } from './export';
import {
  openBackup,
  readBackupHeader,
  restoreBackup,
  verifyBackup,
  type RestoreSummary,
} from './restore';

export interface BackupSource {
  exportSpace(onProgress?: (p: BackupProgress) => void): Promise<ExportResult>;
  /** Solo con una copia de ESTE espacio (`other_space` si no). Sube lo que falte; lo que ya está no se toca. */
  continueRestore(file: Blob, onProgress?: (p: BackupProgress) => void): Promise<RestoreSummary>;
}

export function createBackupSource(repo: Repository, keyring: Keyring): BackupSource {
  return {
    exportSpace: (onProgress) => exportSpace(repo, keyring, onProgress ? { onProgress } : {}),
    async continueRestore(file, onProgress) {
      const opened = await openBackup(file, await readBackupHeader(file), keyring);
      await verifyBackup(opened, onProgress);
      return restoreBackup(repo, keyring, opened, onProgress);
    },
  };
}
