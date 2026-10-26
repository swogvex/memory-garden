import { describe, expect, it } from 'vitest';
import { between, fnv1a, jitter, makeRng, mulberry32 } from '@/lib/flowers';

describe('generador determinista de las flores', () => {
  it('FNV-1a de 32 bits coincide con los vectores de referencia publicados', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('usa los bytes UTF-8: «ñ» no coincide con «n»', () => {
    expect(fnv1a('otoño')).not.toBe(fnv1a('otono'));
  });

  it('la misma semilla da siempre la misma secuencia', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = Array.from({ length: 8 }, () => a());
    expect(Array.from({ length: 8 }, () => b())).toEqual(first);
  });

  it('semillas distintas dan secuencias distintas', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
    expect(makeRng('2026-10|a')()).not.toBe(makeRng('2026-10|b')());
  });

  it('los valores caen en [0, 1) y se reparten por todo el intervalo', () => {
    const rng = mulberry32(99);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 5000; i++) {
      const v = rng();
      expect(v >= 0 && v < 1).toBe(true);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(0.99);
  });

  it('between y jitter respetan sus rangos', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      const b = between(rng, 10, 20);
      const j = jitter(rng, 3);
      expect(b >= 10 && b < 20).toBe(true);
      expect(j >= -3 && j < 3).toBe(true);
    }
  });
});
