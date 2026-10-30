import { describe, expect, it } from 'vitest';
import { formatCompactDate, isKnownTimeZone, listTimeZones } from '@/lib/dates';
import { DATE_FORMATS } from '@/lib/validation/limits';

/** H8.1 · formato de fecha corto elegido en Configuración y lista de zonas horarias. */
describe('formatCompactDate', () => {
  const d = { year: 2026, month: 10, day: 5 };

  it('ymd es ISO, sin depender del idioma', () => {
    expect(formatCompactDate(d, 'es', 'ymd')).toBe('2026-10-05');
    expect(formatCompactDate(d, 'en', 'ymd')).toBe('2026-10-05');
  });

  it('dmy y mdy ordenan día, mes y año; el mes sale del idioma', () => {
    expect(formatCompactDate(d, 'es', 'dmy')).toMatch(/^5 oct\.? 2026$/);
    expect(formatCompactDate(d, 'en', 'mdy')).toBe('Oct 5, 2026');
    expect(formatCompactDate(d, 'en', 'dmy')).toBe('5 Oct 2026');
  });

  it('el 31 de diciembre y el 1 de enero no cambian de día (fecha de calendario, sin zona)', () => {
    expect(formatCompactDate({ year: 2026, month: 12, day: 31 }, 'en', 'ymd')).toBe('2026-12-31');
    expect(formatCompactDate({ year: 2027, month: 1, day: 1 }, 'en', 'mdy')).toBe('Jan 1, 2027');
  });

  it('cubre todos los formatos que admite el esquema de ajustes', () => {
    expect(DATE_FORMATS).toEqual(['dmy', 'mdy', 'ymd']);
    for (const f of DATE_FORMATS) expect(formatCompactDate(d, 'es', f)).toContain('2026');
  });
});

describe('zonas horarias', () => {
  it('lista zonas IANA e incluye siempre la del dispositivo', () => {
    const zones = listTimeZones('Europe/Madrid');
    expect(zones).toContain('Europe/Madrid');
    expect(zones.length).toBeGreaterThan(1);
    expect(listTimeZones('Zona/Inventada')[0]).toBe('Zona/Inventada');
  });

  it('reconoce zonas válidas y rechaza las inventadas', () => {
    expect(isKnownTimeZone('America/New_York')).toBe(true);
    expect(isKnownTimeZone('Zona/Inventada')).toBe(false);
  });
});
