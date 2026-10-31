/**
 * Búsqueda y filtros de Explorar (D-280). Funciones puras: sin red, sin DOM y sin claves.
 * Trabajan sobre los recuerdos ya descifrados que la vista tiene en memoria; nada de esto sale del navegador.
 */
import type { GardenMemory } from '@/features/calendar';
import { FLOWERS, SEASONS } from '@/lib/validation';

/** Valores de los controles. `''` = «Todas». El año va como texto («2026»), igual que en el `<select>`. */
export interface ExploreFilters {
  query: string;
  category: string;
  flower: string;
  season: string;
  year: string;
}

export const NO_FILTERS: Readonly<ExploreFilters> = {
  query: '',
  category: '',
  flower: '',
  season: '',
  year: '',
};

/** Opciones que tienen sentido: solo lo que aparece en algún recuerdo. */
interface ExploreOptions {
  readonly categories: readonly string[];
  readonly flowers: readonly GardenMemory['flower'][];
  readonly seasons: readonly GardenMemory['season'][];
  readonly years: readonly string[];
}

/** Minúsculas y sin marcas diacríticas (NFD): «Castañas» → «castanas», «Árbol» → «arbol». */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

function words(query: string): string[] {
  return fold(query)
    .split(/\s+/)
    .filter((w) => w !== '');
}

/** Texto donde se busca: título, texto, categoría y textos alternativos de las fotos. Se calcula una vez por recuerdo. */
const haystacks = new WeakMap<GardenMemory, string>();
function haystack(memory: GardenMemory): string {
  let text = haystacks.get(memory);
  if (text === undefined) {
    text = fold(
      [memory.title, memory.text, memory.category, ...memory.photos.map((p) => p.alt)].join('\n'),
    );
    haystacks.set(memory, text);
  }
  return text;
}

/** Del más reciente al más antiguo; en el mismo día, el último editado primero. Orden total y estable. */
function newestFirst(a: GardenMemory, b: GardenMemory): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function hasFilters(f: Readonly<ExploreFilters>): boolean {
  return (
    words(f.query).length > 0 ||
    f.category !== '' ||
    f.flower !== '' ||
    f.season !== '' ||
    f.year !== ''
  );
}

/** Recuerdos que cumplen todo a la vez. Cada palabra de la búsqueda tiene que aparecer (en cualquier campo). */
export function filterMemories(
  memories: readonly GardenMemory[],
  f: Readonly<ExploreFilters>,
): GardenMemory[] {
  const terms = words(f.query);
  return memories
    .filter(
      (m) =>
        (f.category === '' || m.category === f.category) &&
        (f.flower === '' || m.flower === f.flower) &&
        (f.season === '' || m.season === f.season) &&
        (f.year === '' || m.date.slice(0, 4) === f.year) &&
        terms.every((t) => haystack(m).includes(t)),
    )
    .sort(newestFirst);
}

export function filterOptions(memories: readonly GardenMemory[], locale: string): ExploreOptions {
  const categories = new Set<string>();
  const flowers = new Set<string>();
  const seasons = new Set<string>();
  const years = new Set<string>();
  for (const m of memories) {
    categories.add(m.category);
    flowers.add(m.flower);
    seasons.add(m.season);
    years.add(m.date.slice(0, 4));
  }
  return {
    categories: [...categories].sort((a, b) => a.localeCompare(b, locale)),
    flowers: FLOWERS.filter((id) => flowers.has(id)),
    seasons: SEASONS.filter((id) => seasons.has(id)),
    years: [...years].sort().reverse(),
  };
}

/**
 * Si un filtro elegido ya no existe (se borró o editó el último recuerdo con esa categoría, flor, temporada o año),
 * vuelve a «Todas». Devuelve `null` si no hay nada que cambiar.
 */
export function dropUnavailable(
  f: Readonly<ExploreFilters>,
  o: ExploreOptions,
): ExploreFilters | null {
  const next: ExploreFilters = {
    query: f.query,
    category: f.category !== '' && !o.categories.includes(f.category) ? '' : f.category,
    flower: f.flower !== '' && !o.flowers.some((x) => x === f.flower) ? '' : f.flower,
    season: f.season !== '' && !o.seasons.some((x) => x === f.season) ? '' : f.season,
    year: f.year !== '' && !o.years.includes(f.year) ? '' : f.year,
  };
  return next.category === f.category &&
    next.flower === f.flower &&
    next.season === f.season &&
    next.year === f.year
    ? null
    : next;
}
