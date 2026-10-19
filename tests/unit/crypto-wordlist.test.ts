// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  WORDLIST_ES,
  generateSpanishPassphrase,
  PASSPHRASE_WORDS_ES,
  checkPasswordPolicy,
} from '../../src/lib/crypto';
import { generatePassphrase } from '../../src/lib/crypto/password-policy';

/** Lista de palabras para la frase de paso (D-063, pregunta abierta 16). Comprueba las propiedades que la entropía exige. */
describe('lista de palabras en español y frase de paso', () => {
  it('tiene 2.048 palabras únicas, solo a–z y de 3 a 8 letras', () => {
    expect(WORDLIST_ES).toHaveLength(2048);
    expect(new Set(WORDLIST_ES).size).toBe(2048);
    for (const w of WORDLIST_ES) expect(/^[a-z]{3,8}$/.test(w)).toBe(true);
  });

  it('las 4 primeras letras bastan para identificar cada palabra (propiedad de BIP-39 que se conserva sin acentos)', () => {
    expect(new Set(WORDLIST_ES.map((w) => w.slice(0, 4))).size).toBe(2048);
  });

  it('5 palabras de esta lista NO llegan a los ~64 bits de §4.5; 6 sí (corrección S-5)', () => {
    expect(generatePassphrase(WORDLIST_ES, 5).entropyBits).toBe(55);
    expect(PASSPHRASE_WORDS_ES).toBe(6);
    expect(generateSpanishPassphrase().entropyBits).toBe(66);
  });

  it('la frase generada son 6 palabras de la lista, cumple la política de contraseña y cambia en cada llamada', () => {
    const a = generateSpanishPassphrase();
    const b = generateSpanishPassphrase();
    const parts = a.text.split('-');
    expect(parts).toHaveLength(6);
    for (const w of parts) expect(WORDLIST_ES.includes(w)).toBe(true);
    expect(checkPasswordPolicy(a.text).ok).toBe(true);
    expect(a.text).not.toBe(b.text); // 2^66 posibilidades: una coincidencia indicaría un fallo de aleatoriedad
  });
});
