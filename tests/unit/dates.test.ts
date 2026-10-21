import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  capitalize,
  compareDates,
  daysInMonth,
  deviceTimeZone,
  formatLongDate,
  formatMonthYear,
  fromEpochDay,
  isLeapYear,
  isValidDate,
  mondayIndex,
  monthGrid,
  monthOf,
  parseIso,
  todayIn,
  toEpochDay,
  toIso,
  weekdayLabels,
  ymKey,
} from '@/lib/dates';
import { isCalendarDate } from '@/lib/validation/checks';

const d = (year: number, month: number, day: number) => ({ year, month, day });
const iso = (date: { year: number; month: number; day: number }) => toIso(date);

describe('años bisiestos y longitud de mes', () => {
  it('reglas del calendario gregoriano', () => {
    expect([2024, 2028, 2000].every(isLeapYear)).toBe(true);
    expect([2025, 2026, 2100, 1900].some(isLeapYear)).toBe(false);
  });
  it('meses de 28 a 31 días', () => {
    expect(Array.from({ length: 12 }, (_, i) => daysInMonth(2026, i + 1))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError);
  });
});

describe('29 de febrero', () => {
  it('existe solo en bisiesto', () => {
    expect(parseIso('2024-02-29')).toEqual(d(2024, 2, 29));
    expect(parseIso('2000-02-29')).toEqual(d(2000, 2, 29));
    expect(parseIso('2025-02-29')).toBeNull();
    expect(parseIso('2100-02-29')).toBeNull();
    expect(isValidDate(2026, 2, 29)).toBe(false);
  });
  it('el día siguiente y el anterior son correctos', () => {
    expect(iso(addDays(d(2024, 2, 28), 1))).toBe('2024-02-29');
    expect(iso(addDays(d(2025, 2, 28), 1))).toBe('2025-03-01');
    expect(iso(addDays(d(2024, 2, 29), 1))).toBe('2024-03-01');
    expect(iso(addDays(d(2024, 3, 1), -1))).toBe('2024-02-29');
  });
});

describe('cambio de año y de mes', () => {
  it('addMonths cruza años en ambos sentidos', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 10 }, 15)).toEqual({ year: 2028, month: 1 });
    expect(addMonths({ year: 2026, month: 3 }, -27)).toEqual({ year: 2023, month: 12 });
    expect(addMonths({ year: 2026, month: 5 }, 0)).toEqual({ year: 2026, month: 5 });
  });
  it('31 de diciembre → 1 de enero', () => {
    expect(iso(addDays(d(2026, 12, 31), 1))).toBe('2027-01-01');
    expect(iso(addDays(d(2027, 1, 1), -1))).toBe('2026-12-31');
  });
});

describe('formato ISO estricto', () => {
  it('genera y lee AAAA-MM-DD', () => {
    expect(toIso(d(2026, 3, 5))).toBe('2026-03-05');
    expect(parseIso('2026-03-05')).toEqual(d(2026, 3, 5));
    expect(ymKey({ year: 2026, month: 3 })).toBe('2026-03');
    expect(monthOf(d(2026, 3, 5))).toEqual({ year: 2026, month: 3 });
  });
  it('rechaza formatos laxos o fechas imposibles', () => {
    for (const bad of [
      '2026-3-5',
      ' 2026-03-05',
      '2026-03-05 ',
      '2026-03-05T00:00',
      '+2026-03-05',
      '２０２６-03-05',
      '2026-13-01',
      '2026-00-10',
      '2026-04-31',
      '0000-01-01',
      '',
    ]) {
      expect(parseIso(bad), bad).toBeNull();
    }
  });
  it('coincide con el validador de lib/validation en el rango de la aplicación', () => {
    for (const s of [
      '2026-02-29',
      '2024-02-29',
      '2026-12-31',
      '2026-04-31',
      '1900-01-01',
      '2200-12-31',
      '2026-1-1',
      '2026-13-01',
      'abcd',
    ]) {
      expect(parseIso(s) !== null, s).toBe(isCalendarDate(s));
    }
  });
  it('compareDates ordena por año, mes y día', () => {
    expect(compareDates(d(2026, 1, 1), d(2025, 12, 31))).toBeGreaterThan(0);
    expect(compareDates(d(2026, 2, 1), d(2026, 2, 1))).toBe(0);
  });
});

describe('aritmética de días (contraste con Date en UTC)', () => {
  it('valores conocidos', () => {
    expect(toEpochDay(d(1970, 1, 1))).toBe(0);
    expect(toEpochDay(d(2000, 3, 1))).toBe(11017);
    expect(toEpochDay(d(2024, 2, 29))).toBe(19782);
    expect(toEpochDay(d(2026, 10, 20))).toBe(20746);
  });
  it('coincide con Date para todos los días de 1900 a 2200 (ida y vuelta y día de la semana)', () => {
    const first = Date.UTC(1900, 0, 1) / 86_400_000;
    const last = Date.UTC(2200, 11, 31) / 86_400_000;
    const bad: number[] = [];
    for (let n = first; n <= last; n++) {
      const dt = new Date(n * 86_400_000);
      const expected = {
        year: dt.getUTCFullYear(),
        month: dt.getUTCMonth() + 1,
        day: dt.getUTCDate(),
      };
      const back = fromEpochDay(n);
      if (
        toEpochDay(expected) !== n ||
        back.year !== expected.year ||
        back.month !== expected.month ||
        back.day !== expected.day ||
        mondayIndex(expected) !== (dt.getUTCDay() + 6) % 7
      ) {
        bad.push(n);
        if (bad.length > 5) break;
      }
    }
    expect(bad).toEqual([]);
  });
  it('días de la semana conocidos (0 = lunes)', () => {
    expect(mondayIndex(d(2024, 1, 1))).toBe(0);
    expect(mondayIndex(d(2026, 10, 20))).toBe(1);
    expect(mondayIndex(d(2026, 1, 1))).toBe(3);
    expect(mondayIndex(d(2000, 1, 1))).toBe(5);
    expect(mondayIndex(d(2026, 3, 29))).toBe(6);
  });
});

describe('cuadrícula mensual (lunes primero, 6 semanas)', () => {
  const flat = (year: number, month: number) => monthGrid({ year, month }).flat();

  it('octubre de 2026 empieza el lunes 28 de septiembre', () => {
    const cells = flat(2026, 10);
    expect(cells).toHaveLength(42);
    expect(cells[0]?.iso).toBe('2026-09-28');
    expect(cells[0]?.inMonth).toBe(false);
    expect(cells[3]?.iso).toBe('2026-10-01');
    expect(cells[3]?.inMonth).toBe(true);
    expect(cells[33]?.iso).toBe('2026-10-31');
    expect(cells[41]?.iso).toBe('2026-11-08');
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
  });
  it('cada columna coincide con su día de la semana', () => {
    for (const [y, m] of [
      [2026, 10],
      [2027, 2],
      [2028, 2],
      [2026, 12],
    ] as const) {
      monthGrid({ year: y, month: m }).forEach((week) =>
        week.forEach((cell, col) => expect(mondayIndex(cell.date)).toBe(col)),
      );
    }
  });
  it('febrero de 2027 (28 días) empieza en lunes', () => {
    const cells = flat(2027, 2);
    expect(cells[0]?.iso).toBe('2027-02-01');
    expect(cells[27]?.iso).toBe('2027-02-28');
    expect(cells[27]?.inMonth).toBe(true);
    expect(cells[28]?.iso).toBe('2027-03-01');
    expect(cells[28]?.inMonth).toBe(false);
  });
  it('febrero de 2028 (bisiesto) incluye el día 29', () => {
    const cells = flat(2028, 2);
    expect(cells[0]?.iso).toBe('2028-01-31');
    expect(cells[29]?.iso).toBe('2028-02-29');
    expect(cells[29]?.inMonth).toBe(true);
    expect(cells[30]?.iso).toBe('2028-03-01');
    expect(cells.filter((c) => c.inMonth)).toHaveLength(29);
  });
  it('el 31 de diciembre y el 1 de enero caen en su día, y cada uno solo cuenta en su mes', () => {
    const dec = flat(2026, 12);
    expect(dec[31]).toMatchObject({ iso: '2026-12-31', inMonth: true });
    expect(dec[32]).toMatchObject({ iso: '2027-01-01', inMonth: false });
    const jan = flat(2027, 1);
    expect(jan[3]).toMatchObject({ iso: '2026-12-31', inMonth: false });
    expect(jan[4]).toMatchObject({ iso: '2027-01-01', inMonth: true });
  });
});

describe('«hoy» según la zona (fechas de calendario, sin hora)', () => {
  const at = (instant: string, zone: string) => iso(todayIn(zone, new Date(instant)));

  it('el cambio de día sigue la medianoche local', () => {
    expect(at('2026-03-28T22:59:59Z', 'Europe/Madrid')).toBe('2026-03-28');
    expect(at('2026-03-28T23:00:00Z', 'Europe/Madrid')).toBe('2026-03-29');
  });
  it('cambio de horario de primavera (29 mar 2026): el día local dura 23 h', () => {
    expect(at('2026-03-29T21:59:59Z', 'Europe/Madrid')).toBe('2026-03-29');
    expect(at('2026-03-29T22:00:00Z', 'Europe/Madrid')).toBe('2026-03-30');
  });
  it('cambio de horario de otoño (25 oct 2026): el día local dura 25 h', () => {
    expect(at('2026-10-24T21:59:59Z', 'Europe/Madrid')).toBe('2026-10-24');
    expect(at('2026-10-24T22:00:00Z', 'Europe/Madrid')).toBe('2026-10-25');
    expect(at('2026-10-25T22:59:59Z', 'Europe/Madrid')).toBe('2026-10-25');
    expect(at('2026-10-25T23:00:00Z', 'Europe/Madrid')).toBe('2026-10-26');
  });
  it('el mismo instante es otro día según la zona del usuario', () => {
    const instant = '2026-10-20T23:30:00Z';
    expect(at(instant, 'Europe/Madrid')).toBe('2026-10-21');
    expect(at(instant, 'America/Los_Angeles')).toBe('2026-10-20');
    expect(at(instant, 'Pacific/Honolulu')).toBe('2026-10-20');
    expect(at(instant, 'Pacific/Auckland')).toBe('2026-10-21');
    expect(at(instant, 'Pacific/Kiritimati')).toBe('2026-10-21');
    expect(at(instant, 'Asia/Kolkata')).toBe('2026-10-21');
  });
  it('año nuevo y bisiesto según la zona', () => {
    expect(at('2026-12-31T23:30:00Z', 'Europe/Madrid')).toBe('2027-01-01');
    expect(at('2026-12-31T23:30:00Z', 'America/New_York')).toBe('2026-12-31');
    expect(at('2028-02-28T23:30:00Z', 'Europe/Madrid')).toBe('2028-02-29');
    expect(at('2027-02-28T23:30:00Z', 'Europe/Madrid')).toBe('2027-03-01');
  });
  it('una zona inválida cae a la del dispositivo sin lanzar', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    expect(() => todayIn('No/Existe', now)).not.toThrow();
    expect(todayIn('No/Existe', now)).toEqual(todayIn(deviceTimeZone(), now));
  });
});

describe('etiquetas localizadas', () => {
  it('semana en español e inglés, lunes primero', () => {
    const es = weekdayLabels('es');
    expect(es).toHaveLength(7);
    expect(es[0]?.long).toBe('lunes');
    expect(es[6]?.long).toBe('domingo');
    const en = weekdayLabels('en');
    expect(en[0]?.long).toBe('Monday');
    expect(en[6]?.long).toBe('Sunday');
  });
  it('mes y fecha completa', () => {
    expect(formatMonthYear({ year: 2026, month: 10 }, 'es')).toMatch(/octubre.*2026/);
    const long = formatLongDate(d(2026, 10, 20), 'es');
    expect(long).toContain('martes');
    expect(long).toContain('octubre');
    expect(long).toContain('2026');
    expect(capitalize('octubre de 2026')).toBe('Octubre de 2026');
  });
});
