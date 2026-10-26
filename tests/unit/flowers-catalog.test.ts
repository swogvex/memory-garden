import { describe, expect, it } from 'vitest';
import { es } from '@/lib/i18n/es';
import { FLOWERS, SEASONS } from '@/lib/validation';
import {
  FLOWER_IDS,
  FLOWER_INFO,
  flowerKey,
  flowersForSeason,
  isFlowerId,
  type FlowerField,
} from '@/lib/flowers';

const FIELDS: readonly FlowerField[] = ['name', 'meaning', 'alt'];
const texts = es as Readonly<Record<string, string>>;

describe('catálogo de flores', () => {
  it('tiene las mismas 8 flores que el esquema de validación (mismo orden)', () => {
    expect([...FLOWER_IDS]).toEqual([...FLOWERS]);
  });

  it('cada flor tiene su ficha con su propio id', () => {
    for (const id of FLOWER_IDS) expect(FLOWER_INFO[id].id).toBe(id);
  });

  it('las temporadas usan los identificadores del esquema', () => {
    for (const id of FLOWER_IDS) {
      const seasons = FLOWER_INFO[id].seasons;
      expect(seasons.length).toBeGreaterThan(0);
      for (const s of seasons) expect((SEASONS as readonly string[]).includes(s)).toBe(true);
    }
  });

  it('las sugerencias por temporada siguen DISENO.md §6', () => {
    expect([...flowersForSeason('primavera')].sort()).toEqual(['margarita', 'tulipan']);
    expect([...flowersForSeason('verano')].sort()).toEqual(['girasol', 'hortensia', 'lavanda']);
    expect([...flowersForSeason('otono')].sort()).toEqual(['dalia', 'rosa']);
    expect([...flowersForSeason('invierno')].sort()).toEqual(['camelia', 'rosa']);
  });

  it('nombre, significado y texto alternativo existen en español para cada flor', () => {
    for (const id of FLOWER_IDS) {
      for (const field of FIELDS) {
        const text = texts[flowerKey(id, field)];
        expect(typeof text).toBe('string');
        expect((text ?? '').trim().length).toBeGreaterThan(2);
      }
      expect((texts[flowerKey(id, 'alt')] ?? '').length).toBeGreaterThan(30);
    }
  });

  it('el texto alternativo no es solo «flor» y los significados no se repiten', () => {
    const meanings = FLOWER_IDS.map((id) => texts[flowerKey(id, 'meaning')]);
    expect(new Set(meanings).size).toBe(FLOWER_IDS.length);
  });

  it('isFlowerId acepta los ids y rechaza lo demás', () => {
    expect(isFlowerId('rosa')).toBe(true);
    expect(isFlowerId('tulipán')).toBe(false);
    expect(isFlowerId('__proto__')).toBe(false);
    expect(isFlowerId('')).toBe(false);
  });
});
