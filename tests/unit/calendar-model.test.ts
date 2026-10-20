import { describe, expect, it } from 'vitest';
import {
  groupByDate,
  memoriesInMonth,
  monthCounts,
  sortChronologically,
  sortRecent,
  type GardenMemory,
} from '@/features/calendar';

function mem(id: string, date: string, title: string, updatedAt = 1): GardenMemory {
  return {
    id,
    date,
    title,
    updatedAt,
    category: 'Momentos',
    text: '',
    link: null,
    flower: 'rosa',
    season: 'otono',
    photos: [],
  };
}

const SAMPLE = [
  mem('a', '2025-12-31', 'Nochevieja'),
  mem('b', '2026-01-01', 'Año nuevo'),
  mem('c', '2026-01-01', 'Brindis', 2),
  mem('d', '2026-01-01', 'Amanecer', 2),
  mem('e', '2026-02-14', 'San Valentín'),
];

describe('modelo del Jardín', () => {
  it('el 31 de diciembre y el 1 de enero quedan en su día', () => {
    const groups = groupByDate(SAMPLE);
    expect(groups.get('2025-12-31')?.map((m) => m.id)).toEqual(['a']);
    expect(groups.get('2026-01-01')).toHaveLength(3);
    expect(memoriesInMonth(SAMPLE, { year: 2025, month: 12 }).map((m) => m.id)).toEqual(['a']);
    expect(
      memoriesInMonth(SAMPLE, { year: 2026, month: 1 })
        .map((m) => m.id)
        .sort(),
    ).toEqual(['b', 'c', 'd']);
  });
  it('varios en un día: orden de creación y, si empata, por título', () => {
    expect(
      groupByDate(SAMPLE)
        .get('2026-01-01')
        ?.map((m) => m.id),
    ).toEqual(['b', 'd', 'c']);
  });
  it('recuentos por mes', () => {
    const counts = monthCounts(SAMPLE);
    expect(counts.get('2026-01')).toBe(3);
    expect(counts.get('2025-12')).toBe(1);
    expect(counts.get('2026-03')).toBeUndefined();
  });
  it('orden cronológico y reciente, sin mutar la entrada', () => {
    const before = SAMPLE.map((m) => m.id).join();
    expect(sortChronologically(SAMPLE).map((m) => m.id)).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(sortRecent(SAMPLE).map((m) => m.id)).toEqual(['e', 'c', 'd', 'b', 'a']);
    expect(SAMPLE.map((m) => m.id).join()).toBe(before);
  });
  it('un mes vacío da una lista vacía', () => {
    expect(memoriesInMonth(SAMPLE, { year: 2026, month: 3 })).toEqual([]);
  });
});
