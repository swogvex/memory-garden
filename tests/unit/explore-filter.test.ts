import { describe, expect, it } from 'vitest';
import type { GardenMemory } from '@/features/calendar';
import {
  NO_FILTERS,
  dropUnavailable,
  filterMemories,
  filterOptions,
  hasFilters,
  type ExploreFilters,
} from '@/features/explore';
import { FLOWERS, SEASONS } from '@/lib/validation';

let n = 0;
function memory(
  fields: Partial<GardenMemory> & Pick<GardenMemory, 'title' | 'date'>,
): GardenMemory {
  n += 1;
  return {
    id: `m${String(n).padStart(21, '0')}`,
    updatedAt: n,
    category: 'Momentos',
    text: '',
    link: null,
    flower: 'rosa',
    season: 'otono',
    photos: [],
    ...fields,
  };
}
const filters = (f: Partial<ExploreFilters>): ExploreFilters => ({ ...NO_FILTERS, ...f });
const titles = (list: readonly GardenMemory[]) => list.map((m) => m.title);

const castanas = memory({ title: 'Castañas', date: '2026-10-28', category: 'Naturaleza' });
const playa = memory({
  title: 'Atardecer',
  date: '2026-07-18',
  text: 'En la playa, con el MAR en calma.',
  season: 'verano',
  flower: 'margarita',
});
const museo = memory({
  title: 'Museo',
  date: '2025-12-31',
  category: 'Citas',
  season: 'invierno',
  flower: 'camelia',
  photos: [{ assetId: 'a'.repeat(22), thumbId: 'b'.repeat(22), alt: 'Cuadro del árbol' }],
});
const marcado = memory({ title: 'Prueba <script>alert(1)</script>', date: '2026-10-19' });
const all = [museo, castanas, marcado, playa];

describe('Explorar: búsqueda', () => {
  it('sin búsqueda ni filtros devuelve todo, del más reciente al más antiguo', () => {
    expect(titles(filterMemories(all, NO_FILTERS))).toEqual([
      'Castañas',
      'Prueba <script>alert(1)</script>',
      'Atardecer',
      'Museo',
    ]);
  });

  it('no distingue mayúsculas ni tildes, en ninguno de los dos sentidos', () => {
    expect(titles(filterMemories(all, filters({ query: 'CASTANAS' })))).toEqual(['Castañas']);
    expect(titles(filterMemories(all, filters({ query: 'castañas' })))).toEqual(['Castañas']);
    expect(titles(filterMemories(all, filters({ query: 'ÁRBOL' })))).toEqual(['Museo']);
  });

  it('busca en título, texto, categoría y texto alternativo de las fotos', () => {
    expect(titles(filterMemories(all, filters({ query: 'museo' })))).toEqual(['Museo']);
    expect(titles(filterMemories(all, filters({ query: 'mar' })))).toEqual(['Atardecer']);
    expect(titles(filterMemories(all, filters({ query: 'naturaleza' })))).toEqual(['Castañas']);
    expect(titles(filterMemories(all, filters({ query: 'cuadro' })))).toEqual(['Museo']);
  });

  it('no busca en la fecha ni en el enlace', () => {
    const conEnlace = memory({
      title: 'Receta',
      date: '2026-01-02',
      link: 'https://example.com/pan',
    });
    expect(filterMemories([conEnlace], filters({ query: 'example' }))).toEqual([]);
    expect(filterMemories([conEnlace], filters({ query: '2026' }))).toEqual([]);
  });

  it('todas las palabras tienen que aparecer, en cualquier orden y campo', () => {
    expect(titles(filterMemories(all, filters({ query: 'calma  atardecer' })))).toEqual([
      'Atardecer',
    ]);
    expect(filterMemories(all, filters({ query: 'castañas playa' }))).toEqual([]);
  });

  it('una búsqueda de solo espacios no filtra', () => {
    expect(filterMemories(all, filters({ query: '   ' }))).toHaveLength(all.length);
    expect(hasFilters(filters({ query: '   ' }))).toBe(false);
  });

  it('el texto con marcado se busca como texto, sin interpretarlo', () => {
    expect(titles(filterMemories(all, filters({ query: '<script>' })))).toEqual([
      'Prueba <script>alert(1)</script>',
    ]);
  });

  it('no modifica la lista recibida', () => {
    const copy = [...all];
    filterMemories(all, NO_FILTERS);
    expect(all).toEqual(copy);
  });

  it('en el mismo día, primero el último editado', () => {
    const a = memory({ title: 'A', date: '2026-03-03', updatedAt: 10 });
    const b = memory({ title: 'B', date: '2026-03-03', updatedAt: 20 });
    expect(titles(filterMemories([a, b], NO_FILTERS))).toEqual(['B', 'A']);
  });
});

describe('Explorar: filtros', () => {
  it('categoría, flor, temporada y año, por separado y combinados', () => {
    expect(titles(filterMemories(all, filters({ category: 'Citas' })))).toEqual(['Museo']);
    expect(titles(filterMemories(all, filters({ flower: 'margarita' })))).toEqual(['Atardecer']);
    expect(titles(filterMemories(all, filters({ season: 'invierno' })))).toEqual(['Museo']);
    expect(titles(filterMemories(all, filters({ year: '2025' })))).toEqual(['Museo']);
    expect(
      titles(filterMemories(all, filters({ year: '2026', season: 'otono', query: 'castanas' }))),
    ).toEqual(['Castañas']);
    expect(filterMemories(all, filters({ year: '2025', category: 'Momentos' }))).toEqual([]);
  });

  it('hasFilters detecta cualquier filtro activo', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters(filters({ year: '2026' }))).toBe(true);
    expect(hasFilters(filters({ query: 'x' }))).toBe(true);
  });

  it('las opciones son solo las que aparecen, sin repetir y en orden', () => {
    const o = filterOptions(
      [...all, memory({ title: 'Otra', date: '2024-05-01', category: 'Árbol' })],
      'es',
    );
    expect(o.categories).toEqual(['Árbol', 'Citas', 'Momentos', 'Naturaleza']);
    expect(o.flowers).toEqual(FLOWERS.filter((f) => ['rosa', 'margarita', 'camelia'].includes(f)));
    expect(o.seasons).toEqual(SEASONS.filter((s) => ['otono', 'verano', 'invierno'].includes(s)));
    expect(o.years).toEqual(['2026', '2025', '2024']);
  });

  it('sin recuerdos no hay opciones', () => {
    expect(filterOptions([], 'es')).toEqual({
      categories: [],
      flowers: [],
      seasons: [],
      years: [],
    });
  });

  it('un filtro que ya no existe vuelve a «Todas»; si todo existe, no cambia nada', () => {
    const o = filterOptions(all, 'es');
    expect(dropUnavailable(filters({ category: 'Citas', year: '2025' }), o)).toBeNull();
    expect(
      dropUnavailable(
        filters({ query: 'x', category: 'Viajes', flower: 'girasol', year: '1999' }),
        o,
      ),
    ).toEqual(filters({ query: 'x' }));
  });
});
