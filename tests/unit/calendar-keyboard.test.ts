import { describe, expect, it } from 'vitest';
import { nextFocusDate } from '@/features/calendar';
import { formatShortDate, toIso } from '@/lib/dates';

const d = (year: number, month: number, day: number) => ({ year, month, day });
const go = (from: ReturnType<typeof d>, key: string, shift = false) => {
  const next = nextFocusDate(from, key, shift);
  return next ? toIso(next) : null;
};

describe('navegación por teclado de la cuadrícula', () => {
  it('flechas: ±1 día y ±7 días, cruzando mes y año', () => {
    expect(go(d(2026, 10, 20), 'ArrowRight')).toBe('2026-10-21');
    expect(go(d(2026, 10, 20), 'ArrowLeft')).toBe('2026-10-19');
    expect(go(d(2026, 10, 28), 'ArrowDown')).toBe('2026-11-04');
    expect(go(d(2026, 11, 3), 'ArrowUp')).toBe('2026-10-27');
    expect(go(d(2026, 12, 31), 'ArrowRight')).toBe('2027-01-01');
    expect(go(d(2027, 1, 1), 'ArrowLeft')).toBe('2026-12-31');
  });
  it('Inicio y Fin: lunes y domingo de la semana (lunes primero)', () => {
    expect(go(d(2026, 10, 21), 'Home')).toBe('2026-10-19');
    expect(go(d(2026, 10, 21), 'End')).toBe('2026-10-25');
    expect(go(d(2026, 10, 19), 'Home')).toBe('2026-10-19');
    expect(go(d(2026, 10, 25), 'End')).toBe('2026-10-25');
  });
  it('RePág y AvPág: mes anterior y siguiente con el día ajustado a la longitud del mes', () => {
    expect(go(d(2026, 10, 20), 'PageDown')).toBe('2026-11-20');
    expect(go(d(2026, 1, 31), 'PageDown')).toBe('2026-02-28');
    expect(go(d(2028, 1, 31), 'PageDown')).toBe('2028-02-29');
    expect(go(d(2026, 3, 31), 'PageUp')).toBe('2026-02-28');
    expect(go(d(2026, 1, 15), 'PageUp')).toBe('2025-12-15');
  });
  it('con Mayús salta un año y respeta el 29 de febrero', () => {
    expect(go(d(2028, 2, 29), 'PageDown', true)).toBe('2029-02-28');
    expect(go(d(2028, 2, 29), 'PageUp', true)).toBe('2027-02-28');
  });
  it('otras teclas no hacen nada', () => {
    for (const key of ['a', 'Enter', ' ', 'Tab', 'Escape'])
      expect(go(d(2026, 10, 20), key)).toBeNull();
  });
});

describe('formatShortDate', () => {
  it('día, mes abreviado y año', () => {
    expect(formatShortDate(d(2026, 10, 20), 'es')).toMatch(/20.*oct.*2026/);
  });
});
