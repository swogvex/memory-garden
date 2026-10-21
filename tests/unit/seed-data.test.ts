import { describe, expect, it } from 'vitest';
import {
  buildSeedPayloads,
  SEED_EXPECTED_COUNTS,
  SEED_MARKUP_TITLE,
  SEED_TOTAL,
} from '@/dev/seed-data';
import { parseMemoryPayload } from '@/lib/validation';

describe('datos de prueba (solo desarrollo)', () => {
  const payloads = buildSeedPayloads();

  it('todos son válidos según el esquema real', () => {
    for (const p of payloads) expect(() => parseMemoryPayload(p), p.title).not.toThrow();
  });
  it('son deterministas', () => {
    expect(buildSeedPayloads()).toEqual(payloads);
  });
  it('los recuentos por mes coinciden con los esperados', () => {
    expect(payloads).toHaveLength(SEED_TOTAL);
    const counts: Record<string, number> = {};
    for (const p of payloads) counts[p.date.slice(0, 7)] = (counts[p.date.slice(0, 7)] ?? 0) + 1;
    for (const [month, n] of Object.entries(SEED_EXPECTED_COUNTS)) {
      expect(counts[month] ?? 0, month).toBe(n);
    }
    expect(Object.keys(counts).sort()).toEqual(
      Object.entries(SEED_EXPECTED_COUNTS)
        .filter(([, n]) => n > 0)
        .map(([m]) => m)
        .sort(),
    );
  });
  it('cubre los casos pedidos', () => {
    const dates = payloads.map((p) => p.date);
    expect(dates).toContain('2025-12-31');
    expect(dates).toContain('2026-01-01');
    expect(dates).toContain('2026-12-31');
    expect(dates).toContain('2027-01-01');
    expect(dates).toContain('2028-02-29');
    for (const empty of ['2026-03', '2026-08', '2026-09']) {
      expect(
        dates.some((x) => x.startsWith(empty)),
        empty,
      ).toBe(false);
    }
    expect(dates.filter((x) => x === '2026-07-18')).toHaveLength(4);
    expect(dates.filter((x) => x.startsWith('2026-05'))).toHaveLength(31);
    expect(payloads.some((p) => p.title === SEED_MARKUP_TITLE)).toBe(true);
    expect(Math.max(...payloads.map((p) => p.photos.length))).toBe(5);
    expect(Math.max(...payloads.map((p) => p.title.length))).toBeGreaterThan(80);
  });
});
