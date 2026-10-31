/** API pública de lib/backup (H8.3): copia cifrada `.mgx` (D-100). Sin interfaz ni red propia: usa un `Repository`. */
export { BackupError, MGX_VERSION } from './format';
export type { BackupErrorCode, BackupHeader, BackupManifest } from './format';
export { exportFileName, exportSpace } from './export';
export type { BackupProgress, ExportResult, ExportSummary } from './export';
export { openBackup, readBackupHeader, restoreBackup, verifyBackup } from './restore';
export type { BackupHead, OpenedBackup, RestoreSummary } from './restore';
export { createBackupSource } from './source';
export type { BackupSource } from './source';
export { backupErrorKey, formatBytes } from './messages';
