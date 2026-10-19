import { generatePassphrase } from './password-policy';
import type { Passphrase } from './password-policy';
import { WORDLIST_ES } from './wordlist-es';

/**
 * Frase de paso en español (crypto-spec.md §4.5, D-063). PROPUESTA pendiente de confirmar (pregunta abierta 16).
 *
 * CORRECCIÓN A LA ESPECIFICACIÓN (S-5): §4.5 calculaba 5 palabras ≈ 64,6 bits suponiendo una lista de 7.776 palabras.
 * La lista propuesta (BIP-39 en español) tiene 2.048 palabras = 11 bits por palabra, así que se necesitan
 * 6 palabras (66 bits). Con 5 solo serían 55 bits.
 */
export const PASSPHRASE_WORDS_ES = 6;

export function generateSpanishPassphrase(): Passphrase {
  return generatePassphrase(WORDLIST_ES, PASSPHRASE_WORDS_ES);
}
