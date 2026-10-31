/**
 * Lógica pura de las pantallas de acceso (sin DOM, sin red): comprobaciones de contraseña y de clave de recuperación.
 * Se prueba en `tests/unit/access-model.test.ts`.
 */
import {
  MIN_PASSWORD_LENGTH,
  checkPasswordPolicy,
  isRecoveryKeyWellFormed,
  normalizeForList,
  normalizeRecoveryInput,
  type CommonPasswordData,
} from '@/lib/crypto';
import { t, type Locale } from '@/lib/i18n';

const RECOVERY_KEY_CHARS = 28;
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]*$/;

export type PasswordIssue = 'too_short' | 'common' | 'low_variety' | 'mismatch';
export type PasswordLevel = 0 | 1 | 2 | 3;

/**
 * Problemas de la contraseña elegida. `confirm = undefined` no comprueba la coincidencia.
 * `common`: la lista grande (si ya se ha cargado); sin ella se aplica la política básica.
 */
export function passwordIssues(
  password: string,
  confirm?: string,
  common?: CommonPasswordData | null,
): PasswordIssue[] {
  const issues: PasswordIssue[] = [...checkPasswordPolicy(password, common ?? undefined).reasons];
  if (confirm !== undefined && confirm !== password) issues.push('mismatch');
  return issues;
}

export const PASSWORD_MIN = MIN_PASSWORD_LENGTH;

const LOG2 = (n: number) => Math.log2(n);
/** Una palabra (de un vocabulario de ~65.000) vale como mucho ~16 bits por larga que sea: así no se premian las frases obvias. */
const WORD_BITS = 16;
const COMMON_WORD_BITS = 10;

/**
 * Estimación ORIENTATIVA de bits de entropía. Trocea en palabras, números y símbolos y puntúa cada trozo de forma
 * conservadora: una palabra en minúsculas o con mayúscula inicial vale como una palabra de diccionario (≤ 16 bits),
 * un año 7 bits, una secuencia «1234» 4 bits, un trozo repetido 2 bits. No es criptografía: solo guía al elegir.
 * No sabe si la contraseña se ha filtrado ni conoce tus datos personales.
 */
export function estimatePasswordBits(password: string, common?: CommonPasswordData | null): number {
  const s = password.normalize('NFKC');
  const tokens = s.match(/\p{L}+|\p{N}+|[\s\-_.]+|[^\p{L}\p{N}\s\-_.]/gu) ?? [];
  const seen = new Set<string>();
  let bits = 0;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (/^[\s\-_.]+$/u.test(token)) {
      bits += 1; // separador
      continue;
    }
    if (seen.has(lower)) {
      bits += 2; // repetir un trozo apenas añade nada
      continue;
    }
    seen.add(lower);
    const length = Array.from(token).length;
    if (/^\p{L}+$/u.test(token)) {
      const wordLike = token === lower || token === lower.charAt(0).toUpperCase() + lower.slice(1);
      if (common?.base.has(normalizeForList(token))) bits += COMMON_WORD_BITS;
      else if (wordLike) bits += Math.min(length * LOG2(26), WORD_BITS) + (token === lower ? 0 : 1);
      else bits += length * LOG2(52); // mayúsculas y minúsculas mezcladas: más parecido a algo aleatorio
    } else if (/^\p{N}+$/u.test(token)) {
      const digits = Array.from(token).map(Number);
      const step = digits.length > 1 ? (digits[1] ?? 0) - (digits[0] ?? 0) : NaN;
      const sequence =
        digits.length >= 3 &&
        Math.abs(step) <= 1 &&
        digits.every((d, i) => i === 0 || d - (digits[i - 1] ?? 0) === step);
      if (/^(19|20)\d\d$/.test(token))
        bits += 7; // un año
      else if (sequence)
        bits += 4; // 1234, 4321, 0000
      else bits += length * LOG2(10);
    } else {
      bits += LOG2(33); // un símbolo
    }
  }
  return bits;
}

/**
 * Indicador de fortaleza ESTIMADA (no real): 0 = no cumple la política; 1 = justa (< 50 bits); 2 = buena (< 70);
 * 3 = muy buena. Una frase de 6 palabras al azar (la sugerida) sale «muy buena».
 */
export function passwordLevel(password: string, common?: CommonPasswordData | null): PasswordLevel {
  if (!checkPasswordPolicy(password, common ?? undefined).ok) return 0;
  const bits = estimatePasswordBits(password, common);
  if (bits >= 70) return 3;
  if (bits >= 50) return 2;
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
export function recoveryKeyFileText(key: string, locale: Locale = 'es'): string {
  return [
    t(locale, 'key.file.title'),
    '',
    key,
    '',
    t(locale, 'key.file.line1'),
    t(locale, 'key.file.line2'),
    t(locale, 'key.file.line3'),
    '',
  ].join('\n');
}

/** Nombre del archivo de la clave de recuperación, en el idioma de la interfaz. */
export const recoveryKeyFileName = (locale: Locale = 'es'): string => t(locale, 'key.file.name');
