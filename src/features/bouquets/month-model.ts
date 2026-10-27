import { memoriesInMonth, sortChronologically, type GardenMemory } from '@/features/calendar';
import { ymKey, type YearMonth } from '@/lib/dates';
import { composeBouquet } from './compose';
import type { BouquetLayout, BouquetMemory } from './model';

/** Recuerdo → modelo de vista del ramo (solo lo que el dibujo necesita). */
export function toBouquetMemory(m: GardenMemory): BouquetMemory {
  return { id: m.id, date: m.date, flower: m.flower, hasPhoto: m.photos.length > 0 };
}

/** Un mes de la cuadrícula de Ramos. */
export interface MonthEntry {
  readonly ym: YearMonth;
  /** `AAAA-MM`. */
  readonly key: string;
  readonly count: number;
}

/** Los 12 meses de un año con su número de recuerdos (los meses vacíos también salen). */
export function monthsOfYear(memories: readonly GardenMemory[], year: number): MonthEntry[] {
  const counts = new Map<string, number>();
  for (const m of memories)
    counts.set(m.date.slice(0, 7), (counts.get(m.date.slice(0, 7)) ?? 0) + 1);
  return Array.from({ length: 12 }, (_, i) => {
    const ym: YearMonth = { year, month: i + 1 };
    const key = ymKey(ym);
    return { ym, key, count: counts.get(key) ?? 0 };
  });
}

/** Años con recuerdos, del más reciente al más antiguo; siempre incluye `fallback` (el año actual). */
export function yearsWithMemories(memories: readonly GardenMemory[], fallback: number): number[] {
  const years = new Set<number>([fallback]);
  for (const m of memories) years.add(Number(m.date.slice(0, 4)));
  return [...years].filter(Number.isInteger).sort((a, b) => b - a);
}

/** Recuerdos de un mes en orden cronológico: la alternativa textual completa del ramo. */
export function monthList(memories: readonly GardenMemory[], ym: YearMonth): GardenMemory[] {
  return sortChronologically(memoriesInMonth(memories, ym));
}

/** Composición determinista del ramo de un mes (misma entrada → mismo resultado). */
export function layoutForMonth(memories: readonly GardenMemory[], ym: YearMonth): BouquetLayout {
  return composeBouquet({
    month: ymKey(ym),
    memories: monthList(memories, ym).map(toBouquetMemory),
  });
}

/** `AAAA-MM` → mes; `null` si no es una clave de mes válida. */
export function parseMonthKey(key: string): YearMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}
