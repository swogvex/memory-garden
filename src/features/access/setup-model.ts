/**
 * Lógica pura de las pantallas de acceso (sin DOM, sin red): comprobaciones de contraseña y de clave de recuperación.
 * Se prueba en `tests/unit/access-model.test.ts`.
 */
import {
  MIN_PASSWORD_LENGTH,
  checkPasswordPolicy,
  isRecoveryKeyWellFormed,
  normalizeRecoveryInput,
} from '@/lib/crypto';

export const RECOVERY_KEY_CHARS = 28;
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]*$/;

export type PasswordIssue = 'too_short' | 'common' | 'low_variety' | 'mismatch';
export type PasswordLevel = 0 | 1 | 2 | 3;

/** Problemas de la contraseña elegida. `confirm = undefined` no comprueba la coincidencia. */
export function passwordIssues(password: string, confirm?: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [...checkPasswordPolicy(password).reasons];
  if (confirm !== undefined && confirm !== password) issues.push('mismatch');
  return issues;
}

export const PASSWORD_MIN = MIN_PASSWORD_LENGTH;

/**
 * Indicador de LONGITUD y variedad, no de fortaleza real: no sabe si la contraseña ya se ha filtrado.
 * 0 = no cumple la política; 1 = cumple lo mínimo; 2 = buena; 3 = muy buena (frase larga).
 */
export function passwordLevel(password: string): PasswordLevel {
  if (!checkPasswordPolicy(password).ok) return 0;
  const length = Array.from(password.normalize('NFKC')).length;
  if (length >= 24) return 3;
  if (length >= 18) return 2;
  return 1;
}

/** Texto de una clave normalizado y agrupado de 4 en 4 (solo para mostrar lo que la persona va tecleando). */
export function groupRecoveryInput(input: string): string {
  return (normalizeRecoveryInput(input).match(/.{1,4}/g) ?? []).join('-');
}

export type RecoveryInputState =
  | 'empty'
  /** Aún faltan caracteres: no se avisa de nada mientras escribe. */
  | 'incomplete'
  /** Caracteres imposibles o demasiados. */
  | 'format'
  /** 28 caracteres posibles pero el control (CRC) no cuadra: error de tecleo. */
  | 'checksum'
  /** Bien escrita, pero distinta de la que se mostró (solo si se pasa `expected`). */
  | 'mismatch'
  | 'ok';

/** Estado de lo que teclea la persona. Todo es local: nada de esto consulta al servidor. */
export function recoveryInputState(input: string, expected?: string): RecoveryInputState {
  const s = normalizeRecoveryInput(input);
  if (s.length === 0) return 'empty';
  if (!CROCKFORD.test(s) || s.length > RECOVERY_KEY_CHARS) return 'format';
  if (s.length < RECOVERY_KEY_CHARS) return 'incomplete';
  if (!isRecoveryKeyWellFormed(s)) return 'checksum';
  if (expected !== undefined && normalizeRecoveryInput(expected) !== s) return 'mismatch';
  return 'ok';
}

/** Contenido del archivo de texto que se puede descargar. Nada más que la clave y cómo cuidarla. */
export function recoveryKeyFileText(key: string): string {
  return [
    'Memory Garden - clave de recuperación',
    '',
    key,
    '',
    'Es la única forma de volver a entrar si olvidas tu contraseña.',
    'Guárdala en papel y en un segundo sitio seguro, separada de tu contraseña.',
    'Quien la tenga puede abrir tus recuerdos. Si pierdes la contraseña y esta clave, nadie puede recuperarlos.',
    '',
  ].join('\n');
}
