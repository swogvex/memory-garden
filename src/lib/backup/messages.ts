import type { MessageKey } from '@/lib/i18n';
import type { BackupErrorCode } from './format';

/** Mensaje (clave de i18n) de cada fallo de la copia. Lo usan el asistente de restauración y Configuración. */
export function backupErrorKey(code: BackupErrorCode): MessageKey {
  switch (code) {
    case 'format':
      return 'backup.error.format';
    case 'version':
      return 'backup.error.version';
    case 'credentials':
      return 'backup.error.credentials';
    case 'corrupt':
      return 'backup.error.corrupt';
    case 'other_space':
      return 'backup.error.other_space';
    case 'quota':
      return 'backup.error.quota';
    case 'unavailable':
      return 'backup.error.unavailable';
  }
}

/** Tamaño legible (KB o MB) con los separadores del idioma. */
export function formatBytes(bytes: number, locale: string): string {
  const mb = bytes / (1024 * 1024);
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return mb >= 1 ? `${n.format(mb)} MB` : `${n.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
}
