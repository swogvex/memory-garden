/**
 * Números pseudoaleatorios deterministas para las flores y los ramos.
 * No usa el generador aleatorio del navegador: la misma semilla produce siempre la misma secuencia.
 * No es criptografía y no debe usarse nunca para secretos.
 */

/** Generador: cada llamada devuelve un número en [0, 1). */
export type Rng = () => number;

/** FNV-1a de 32 bits sobre los bytes UTF-8 del texto. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: generador de 32 bits con un solo número de estado. */
export function mulberry32(seed: number): Rng {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generador a partir de una semilla de texto. */
export const makeRng = (seed: string): Rng => mulberry32(fnv1a(seed));

/** Valor en [min, max). */
export const between = (rng: Rng, min: number, max: number): number => min + rng() * (max - min);

/** Valor en [−amount, +amount). */
export const jitter = (rng: Rng, amount: number): number => (rng() * 2 - 1) * amount;
