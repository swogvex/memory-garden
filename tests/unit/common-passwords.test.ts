import { describe, expect, it } from 'vitest';
import { normalizeForList } from '@/lib/crypto';
import {
  COMMON_BASE,
  COMMON_LONG,
  COMMON_PASSWORDS_LICENSE,
  COMMON_PASSWORDS_SHA256,
  COMMON_PASSWORDS_SOURCE,
} from '@/lib/crypto/common-passwords';

/**
 * D-122 · la lista grande debe estar generada con scripts/build-common-passwords.mjs (no la provisional vacía) y tener
 * la forma que espera la política. Si esta prueba falla, falta ejecutar el script (ver la entrega de H8.2).
 */
describe('lista de contraseñas comunes generada', () => {
  it('tiene origen, licencia y huella del archivo, y suficientes entradas', () => {
    expect(COMMON_PASSWORDS_SOURCE).not.toBe('provisional');
    expect(COMMON_PASSWORDS_LICENSE).not.toBe('provisional');
    expect(COMMON_PASSWORDS_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(COMMON_BASE.length).toBeGreaterThanOrEqual(1000);
  });

  it('todas las entradas están normalizadas, sin duplicados y en su tramo de longitud', () => {
    for (const w of COMMON_LONG) {
      expect(normalizeForList(w)).toBe(w);
      expect(Array.from(w).length).toBeGreaterThanOrEqual(14);
    }
    for (const w of COMMON_BASE) {
      expect(w).toMatch(/^\p{L}{4,13}$/u);
      expect(normalizeForList(w)).toBe(w);
    }
    expect(new Set(COMMON_LONG).size).toBe(COMMON_LONG.length);
    expect(new Set(COMMON_BASE).size).toBe(COMMON_BASE.length);
  });
});
