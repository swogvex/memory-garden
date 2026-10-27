import { describe, expect, it } from 'vitest';
import type { GardenMemory } from '@/features/calendar';
import {
  layoutForMonth,
  monthList,
  monthsOfYear,
  parseMonthKey,
  toBouquetMemory,
  yearsWithMemories,
} from '@/features/bouquets';

const mk = (
  id: string,
  date: string,
  flower: GardenMemory['flower'] = 'rosa',
  photos = 0,
): GardenMemory => ({
  id,
  text: '',
  link: null,
  date,
  flower,
  title: id,
  category: 'x',
  season: 'otono',
  updatedAt: 1,
  photos: Array.from({ length: photos }, (_, i) => ({
    assetId: `a${i}`,
    thumbId: `t${i}`,
    alt: '',
  })),
});
const data = [
  mk('c', '2026-10-20'),
  mk('a', '2026-10-02', 'girasol', 1),
  mk('b', '2025-12-31'),
  mk('d', '2026-01-05'),
];

describe('month-model', () => {
  it('mapea a modelo de vista', () => {
    expect(toBouquetMemory(data[1]!)).toEqual({
      id: 'a',
      date: '2026-10-02',
      flower: 'girasol',
      hasPhoto: true,
    });
  });
  it('12 meses con recuentos', () => {
    const y = monthsOfYear(data, 2026);
    expect(y).toHaveLength(12);
    expect([y[9]!.key, y[9]!.count]).toEqual(['2026-10', 2]);
    expect([y[0]!.key, y[0]!.count]).toEqual(['2026-01', 1]);
    expect(y[5]!.count).toBe(0);
  });
  it('años, recientes primero, con el actual', () => {
    expect(yearsWithMemories(data, 2027)).toEqual([2027, 2026, 2025]);
    expect(yearsWithMemories([], 2026)).toEqual([2026]);
  });
  it('lista cronológica del mes', () => {
    expect(monthList(data, { year: 2026, month: 10 }).map((m) => m.id)).toEqual(['a', 'c']);
  });
  it('composición estable al reabrir y independiente del orden de entrada', () => {
    const ym = { year: 2026, month: 10 };
    const a = JSON.stringify(layoutForMonth(data, ym));
    expect(JSON.stringify(layoutForMonth([...data].reverse(), ym))).toBe(a);
    expect(JSON.stringify(layoutForMonth(data, ym))).toBe(a);
  });
  it('claves de mes', () => {
    expect(parseMonthKey('2026-10')).toEqual({ year: 2026, month: 10 });
    for (const bad of ['2026-13', '2026-00', '2026-1', 'x', ''])
      expect(parseMonthKey(bad)).toBeNull();
  });
  it('mes vacío → brote sin flores', () => {
    const l = layoutForMonth(data, { year: 2026, month: 6 });
    expect(l.total).toBe(0);
    expect(l.flowers).toHaveLength(0);
  });
});
