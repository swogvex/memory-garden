import { monthOf, ymKey, type YearMonth } from '@/lib/dates';
import type { MemoryPayload } from '@/lib/validation';

/** Recuerdo ya descifrado y validado, listo para dibujar. */
export type GardenMemory = MemoryPayload & { readonly id: string; readonly updatedAt: number };

/** Puerto de datos del Jardín: lo implementa la capa de composición (adaptador de pruebas hoy, API en H7). */
export interface GardenSource {
  list(): Promise<GardenMemory[]>;
  /** Suelta las claves en memoria. */
  lock(): void;
}

export class GardenUnavailableError extends Error {
  constructor() {
    super('garden:unavailable');
    this.name = 'GardenUnavailableError';
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Orden de creación estable dentro de un día. */
const byCreation = (a: GardenMemory, b: GardenMemory) =>
  a.updatedAt - b.updatedAt || cmp(a.title, b.title) || cmp(a.id, b.id);

export function groupByDate(memories: readonly GardenMemory[]): Map<string, GardenMemory[]> {
  const map = new Map<string, GardenMemory[]>();
  for (const m of memories) {
    const list = map.get(m.date);
    if (list) list.push(m);
    else map.set(m.date, [m]);
  }
  for (const list of map.values()) list.sort(byCreation);
  return map;
}

/** Recuentos por mes (`AAAA-MM`). */
export function monthCounts(memories: readonly GardenMemory[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of memories) {
    const key = m.date.slice(0, 7);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

export function memoriesInMonth(memories: readonly GardenMemory[], ym: YearMonth): GardenMemory[] {
  const prefix = `${ymKey(monthOf({ ...ym, day: 1 }))}-`;
  return memories.filter((m) => m.date.startsWith(prefix));
}

export function sortChronologically(memories: readonly GardenMemory[]): GardenMemory[] {
  return [...memories].sort((a, b) => cmp(a.date, b.date) || byCreation(a, b));
}

export function sortRecent(memories: readonly GardenMemory[]): GardenMemory[] {
  return [...memories].sort((a, b) => cmp(b.date, a.date) || byCreation(b, a));
}
