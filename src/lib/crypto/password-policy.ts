import { randomBytes } from './bytes';
import { MIN_PASSWORD_LENGTH } from './constants';
import { CryptoError } from './errors';

/**
 * Política de contraseña (crypto-spec.md §4.5, D-063). PBKDF2 hace que la contraseña sea el eslabón débil.
 * Esto NO mide fortaleza real: filtra lo evidentemente malo. El medidor visual llega en H8.
 */

/** Lista PROVISIONAL escrita a mano (sin licencia de terceros). Sustituir por una lista verificada (pregunta abierta 16 / D-063). */
const COMMON: readonly string[] = [
  'passwordpassword',
  'password123456',
  'password1234567',
  'passw0rd1234567',
  'contrasena12345',
  'contrasenacontrasena',
  'micontrasena123',
  'micontrasena1234',
  'qwertyuiopasdf',
  'qwertyuiop1234',
  'qwertyuiopasdfgh',
  '1234567890123456',
  '12345678901234',
  '123456789012345',
  '0123456789012345',
  'abcdefghijklmn',
  'abcdefghijklmnop',
  'iloveyou1234567',
  'iloveyouiloveyou',
  'teamoteamoteamo',
  'teamo1234567890',
  'letmein1234567',
  'welcome1234567',
  'administrator123',
  'adminadminadmin',
  'memorygarden123',
  'memorygarden1234',
  'memorygarden2026',
  'memorygarden',
  'asdfghjklzxcvb',
  'asdfghjklqwerty',
  'zxcvbnmasdfghj',
  'football1234567',
  'barcelona123456',
  'realmadrid123456',
  'superman1234567',
  'trustno1trustno1',
  'changemechangeme',
  'cambiamecambiame',
  'monkey123456789',
];

export interface PolicyResult {
  readonly ok: boolean;
  readonly reasons: readonly ('too_short' | 'common' | 'low_variety')[];
}

export function lengthInCodePoints(s: string): number {
  return Array.from(s.normalize('NFKC')).length;
}

export function checkPasswordPolicy(password: string): PolicyResult {
  const reasons: ('too_short' | 'common' | 'low_variety')[] = [];
  const norm = password.normalize('NFKC');
  const cps = Array.from(norm);
  if (cps.length < MIN_PASSWORD_LENGTH) reasons.push('too_short');
  if (COMMON.includes(norm.toLowerCase().replace(/\s+/g, ''))) reasons.push('common');
  if (new Set(cps).size < 5) reasons.push('low_variety');
  return { ok: reasons.length === 0, reasons };
}

export function assertPasswordPolicy(password: string): void {
  if (!checkPasswordPolicy(password).ok) throw new CryptoError('password_policy');
}

/** Entero uniforme en [0, n) por rechazo sobre 16 bits (sin sesgo de módulo). */
function uniformIndex(n: number): number {
  if (!Number.isInteger(n) || n < 2 || n > 65536) throw new CryptoError('invalid_input');
  const limit = Math.floor(65536 / n) * n;
  for (;;) {
    const b = randomBytes(2);
    const v = (b[0]! << 8) | b[1]!;
    if (v < limit) return v % n;
  }
}

export interface Passphrase {
  readonly text: string;
  /** words × log2(|lista|): solo es válido si la lista tiene palabras únicas y se eligió al azar. */
  readonly entropyBits: number;
}

/**
 * Frase de paso de `words` palabras (5 con 7.776 palabras ≈ 64,6 bits, §4.5). La lista en español NO está incluida:
 * su elección y licencia están pendientes (pregunta abierta 16, D-063). La entropía depende SOLO del tamaño de la lista.
 */
export function generatePassphrase(
  wordlist: readonly string[],
  words = 5,
  separator = '-',
): Passphrase {
  if (new Set(wordlist).size !== wordlist.length || words < 1)
    throw new CryptoError('invalid_input');
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(wordlist[uniformIndex(wordlist.length)]!);
  return { text: out.join(separator), entropyBits: words * Math.log2(wordlist.length) };
}
