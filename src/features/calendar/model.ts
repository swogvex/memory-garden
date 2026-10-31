import { monthOf, ymKey, type YearMonth } from '@/lib/dates';
import { StorageError } from '@/lib/storage/errors';
import type { MemoryPayload } from '@/lib/validation';

/** Recuerdo ya descifrado y validado, listo para dibujar. */
export type GardenMemory = MemoryPayload & { readonly id: string; readonly updatedAt: number };

/** Campos de un recuerdo sin las fotos (las fotos se suben aparte). */
export type MemoryFields = Omit<MemoryPayload, 'photos'>;

/** Foto ya procesada en el cliente (JPEG sin metadatos), todavía sin cifrar. */
export interface NewPhoto {
  readonly photo: Uint8Array;
  readonly thumb: Uint8Array;
  readonly alt: string;
}

export interface CreateMemoryInput {
  readonly fields: MemoryFields;
  readonly photos: readonly NewPhoto[];
}

export interface CreateMemoryResult {
  readonly memory: GardenMemory;
  /** Posiciones (0 = primera) de las fotos que no se pudieron subir; el recuerdo se guardó sin ellas. */
  readonly failedPhotos: readonly number[];
  /** Otro dispositivo había cambiado este recuerdo: se ha guardado esta versión encima (D-188). */
  readonly replacedRemote?: boolean;
}

/** Por qué no se pudo guardar un recuerdo (la pantalla elige el mensaje). */
export type SaveFailure = 'offline' | 'remote_changed' | 'quota' | 'generic';

/** Un hueco de foto en edición: una ya guardada o una recién procesada. El orden fija la portada. */
export type PhotoSlot =
  | {
      readonly kind: 'kept';
      readonly assetId: string;
      readonly thumbId: string;
      readonly alt: string;
    }
  | ({ readonly kind: 'new' } & NewPhoto);
export interface SaveMemoryInput {
  readonly fields: MemoryFields;
  readonly photos: readonly PhotoSlot[];
}

/** Puerto de datos del Jardín: lo implementa la capa de composición (adaptador de pruebas hoy, API en H7). */
export interface GardenSource {
  list(): Promise<GardenMemory[]>;
  create(input: CreateMemoryInput): Promise<CreateMemoryResult>;
  update(id: string, input: SaveMemoryInput): Promise<CreateMemoryResult>;
  /** Papelera de 30 días (D-058). */
  trash(id: string): Promise<void>;
  /** URL `blob:` de la miniatura o de la foto `index` del recuerdo; `null` si no está disponible. La URL es de la fuente: no se revoca fuera. */
  imageUrl(memory: GardenMemory, index: number, size: 'thumb' | 'photo'): Promise<string | null>;
  /** Suelta las claves y las imágenes descifradas. */
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

/** Número de días distintos con algún recuerdo. */
export function daysWithMemories(memories: readonly GardenMemory[]): number {
  return new Set(memories.map((m) => m.date)).size;
}

/**
 * Clasifica el fallo de un guardado para el mensaje (H8.4). Recorre la cadena de `cause`: la fuente envuelve el fallo real en
 * `garden:save_failed`. Sin conexión gana a todo lo demás: es lo que la persona puede arreglar.
 */
export function saveFailureOf(error: unknown): SaveFailure {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  let e: unknown = error;
  for (let depth = 0; depth < 5 && e instanceof Error; depth++) {
    if (e.message === 'garden:remote_changed') return 'remote_changed';
    if (e instanceof StorageError && (e.code === 'quota' || e.code === 'too_large')) return 'quota';
    e = e.cause;
  }
  return 'generic';
}
