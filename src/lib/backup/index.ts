/** API pública de lib/backup: copia cifrada `.mgx` (D-100). Sin interfaz ni red propia: usa un `Repository`. */
export { BackupError } from './format';
export type { BackupManifest } from './format';
export { exportSpace } from './export';
export type { BackupProgress, ExportSummary } from './export';
export { openBackup, readBackupHeader, restoreBackup, verifyBackup } from './restore';
export type { BackupHead, OpenedBackup, RestoreSummary } from './restore';
export { createBackupSource } from './source';
export type { BackupSource } from './source';
export { backupErrorKey, formatBytes } from './messages';
