import { describe, expect, it } from 'vitest';
import { FLOWER_IDS, FLOWER_INFO, fnv1a, makeRng } from '@/lib/flowers';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_FLOWERS,
  MAX_POLAROIDS,
  composeBouquet,
  stemPoint,
  type BouquetLayout,
  type BouquetMemory,
} from '@/features/bouquets';

const MONTH = '2026-10';

/** Recuerdos de prueba: flor y fecha repartidas por el mes; los `photos` últimos llevan foto. */
function memories(n: number, photos = 0, tag = 'm'): BouquetMemory[] {
  const rng = makeRng(`${tag}-${n}`);
  return Array.from({ length: n }, (_, i) => ({
    id: `${tag}-${n}-${String(i).padStart(3, '0')}`,
    date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`,
    flower: FLOWER_IDS[Math.floor(rng() * FLOWER_IDS.length)] ?? 'rosa',
    hasPhoto: i >= n - photos,
  }));
}

const compose = (list: readonly BouquetMemory[], month = MONTH) =>
  composeBouquet({ month, memories: list });
const pin = (layout: BouquetLayout) => fnv1a(JSON.stringify(layout)).toString(16).padStart(8, '0');

describe('composición determinista del ramo', () => {
  it('reabrir el ramo no cambia su composición (50 veces seguidas)', () => {
    const list = memories(13, 5);
    const first = JSON.stringify(compose(list));
    for (let i = 0; i < 50; i++) expect(JSON.stringify(compose(list))).toBe(first);
  });

  it('no depende del orden en que llegue la lista', () => {
    const list = memories(30, 5);
    const reversed = [...list].reverse();
    const shuffled = [...list].sort((a, b) => fnv1a(a.id + 'x') - fnv1a(b.id + 'x'));
    const base = compose(list);
    expect(compose(reversed)).toEqual(base);
    expect(compose(shuffled)).toEqual(base);
  });

  it('instantánea: composición fija de un mes de referencia (8 recuerdos, 3 con foto)', () => {
    // Valor fijado con la composición actual (D-151): si la composición cambia a propósito, se actualiza.
    // Si cambia, la composición de los ramos ya creados cambiaría: hay que decidirlo a propósito
    // (y anotarlo en DECISIONES). La semilla no cambia: solo depende del mes y de los ids.
    const layout = compose(memories(8, 3, 'ref'));
    expect(layout.seed).toBe('75aa568b');
    // Cambió con D-253 porque las hojas se colocan de otra forma (no se amontonan sobre el lazo).
    expect(pin(layout)).toBe('4b24f19b');
  });

  it('la semilla cambia con el mes y con el conjunto de recuerdos', () => {
    const list = memories(8);
    const base = compose(list).seed;
    expect(compose(list, '2026-11').seed).not.toBe(base);
    expect(compose(memories(9)).seed).not.toBe(base);
    expect(compose(list.slice(1)).seed).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{8}$/);
  });

  it('la semilla de dibujo de cada flor depende solo del mes y de su id', () => {
    const list = memories(8);
    const before = new Map(compose(list).flowers.map((f) => [f.id, f.seed]));
    const extra: BouquetMemory = {
      id: 'otro',
      date: '2026-10-30',
      flower: 'rosa',
      hasPhoto: false,
    };
    for (const f of compose([...list, extra]).flowers) {
      if (before.has(f.id)) expect(f.seed).toBe(before.get(f.id));
    }
  });

  it('rechaza meses mal formados e ids repetidos', () => {
    expect(() => compose([], '2026-13')).toThrow();
    expect(() => compose([], '2026-1')).toThrow();
    expect(() => compose([], 'octubre')).toThrow();
    const dup = memories(3);
    expect(() => compose([...dup, ...dup.slice(0, 1)])).toThrow();
  });
});

describe('crecimiento y tope visual', () => {
  const cases: readonly (readonly [number, number, number])[] = [
    // recuerdos, flores dibujadas, recuerdos agrupados en «+N más»
    [0, 0, 0],
    [1, 1, 0],
    [8, 8, 0],
    [21, 21, 0],
    [22, 21, 1],
    [30, 21, 9],
    [100, 21, 79],
  ];
  for (const [n, flowers, more] of cases) {
    it(`${n} recuerdos → ${flowers} flores${more ? ` y «+${more} más»` : ''}`, () => {
      const layout = compose(memories(n, 5));
      expect(layout.total).toBe(n);
      expect(layout.flowers).toHaveLength(flowers);
      expect(layout.overflow?.count ?? 0).toBe(more);
      expect(layout.flowers.length + (layout.overflow?.count ?? 0)).toBe(n);
      expect(new Set(layout.flowers.map((f) => f.id)).size).toBe(layout.flowers.length);
    });
  }

  it('con más de 21 recuerdos, las flores dibujadas se reparten por todo el mes', () => {
    const list = memories(100);
    const dates = compose(list)
      .flowers.map((f) => f.date)
      .sort();
    expect(dates[0]).toBe('2026-10-01');
    expect(dates[dates.length - 1]).toBe('2026-10-28');
  });

  it('pocas flores son más grandes que muchas', () => {
    const mean = (n: number) => {
      const fl = compose(memories(n)).flowers;
      return fl.reduce((s, f) => s + f.radius, 0) / fl.length;
    };
    expect(mean(1)).toBeGreaterThan(mean(3));
    expect(mean(3)).toBeGreaterThan(mean(8));
    expect(mean(8)).toBeGreaterThan(mean(21) - 0.01);
  });

  it('el follaje y el relleno crecen con el ramo, con tope', () => {
    expect(compose(memories(21)).leaves.length).toBeGreaterThan(compose(memories(3)).leaves.length);
    expect(compose(memories(21)).filler.length).toBeGreaterThan(compose(memories(3)).filler.length);
    for (const n of [1, 8, 21, 100]) {
      const layout = compose(memories(n));
      expect(layout.leaves.length).toBeGreaterThanOrEqual(2);
      expect(layout.leaves.length).toBeLessThanOrEqual(18);
      expect(layout.filler.length).toBeGreaterThanOrEqual(5);
      expect(layout.filler.length).toBeLessThanOrEqual(18);
      expect(layout.filler.some((f) => f.kind === 'bud')).toBe(false);
    }
  });

  it('un mes vacío tiene su estado propio: capullos cerrados, ramas y hojas, sin flores', () => {
    const layout = compose([]);
    expect(layout.flowers).toHaveLength(0);
    expect(layout.filler.filter((f) => f.kind === 'bud')).toHaveLength(3);
    expect(layout.leaves.length).toBeGreaterThanOrEqual(2);
    for (const l of layout.leaves) expect(l.owner.kind).toBe('filler');
  });

  it('ninguna hoja flota: cada una nace sobre la curva de su tallo', () => {
    for (const n of [0, 1, 3, 8, 21, 100]) {
      for (let k = 0; k < 10; k++) {
        const layout = compose(memories(n, 0, `hoja${k}`));
        for (const l of layout.leaves) {
          const owner =
            l.owner.kind === 'flower'
              ? layout.flowers[l.owner.index]
              : layout.filler[l.owner.index];
          expect(owner).not.toBe(undefined);
          if (!owner) continue;
          const p = stemPoint(owner.stem, l.t);
          expect(Math.hypot(p.x - l.x, p.y - l.y)).toBeLessThan(0.5);
        }
      }
    }
  });

  it('las hojas no se amontonan: bases separadas y como mucho cuatro junto al lazo', () => {
    for (const n of [0, 1, 3, 8, 21, 100]) {
      for (let k = 0; k < 10; k++) {
        const layout = compose(memories(n, 0, `monton${k}`));
        const leaves = layout.leaves;
        for (let i = 0; i < leaves.length; i++) {
          for (let j = i + 1; j < leaves.length; j++) {
            const a = leaves[i] as (typeof leaves)[number];
            const b = leaves[j] as (typeof leaves)[number];
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(18);
          }
        }
        // Antes de este cambio caían ~9 por ramo en la franja estrecha sobre el lazo.
        expect(leaves.filter((l) => l.y > layout.base.y - 95).length).toBeLessThanOrEqual(4);
        for (const l of leaves) expect(l.y).toBeLessThan(layout.base.y - 30);
      }
    }
  });

  it('todos los tallos (flores y relleno) pasan por el lazo', () => {
    for (const n of [0, 1, 8, 30]) {
      const layout = compose(memories(n));
      for (const item of [...layout.flowers, ...layout.filler]) {
        expect(item.stem.y1).toBe(layout.base.y);
        expect(Math.abs(item.stem.x1 - layout.base.x)).toBeLessThanOrEqual(13);
        expect(item.stem.ey).toBeGreaterThan(layout.base.y);
        expect(item.stem.ey).toBeLessThanOrEqual(CANVAS_HEIGHT);
      }
    }
  });
});

describe('equilibrio y límites del lienzo', () => {
  it('300 meses aleatorios por tamaño: dentro del lienzo, equilibrados y sin amontonarse', () => {
    for (const n of [1, 2, 3, 5, 8, 13, 21, 30, 100]) {
      for (let k = 0; k < 40; k++) {
        const layout = compose(memories(n, 0, `eq${k}`));
        let weight = 0;
        let moment = 0;
        for (const f of layout.flowers) {
          expect(f.x - f.radius).toBeGreaterThanOrEqual(0);
          expect(f.x + f.radius).toBeLessThanOrEqual(CANVAS_WIDTH);
          expect(f.y - f.radius).toBeGreaterThanOrEqual(0);
          expect(f.y + f.radius).toBeLessThan(layout.base.y);
          weight += f.radius ** 2;
          moment += f.x * f.radius ** 2;
        }
        expect(Math.abs(moment / weight - CANVAS_WIDTH / 2)).toBeLessThan(2);
        for (let i = 0; i < layout.flowers.length; i++) {
          for (let j = i + 1; j < layout.flowers.length; j++) {
            const a = layout.flowers[i];
            const b = layout.flowers[j];
            if (!a || !b) continue;
            // Una espiga (lavanda) puede quedar algo más metida detrás de otra flor.
            const spike =
              FLOWER_INFO[a.flower].role === 'spike' || FLOWER_INFO[b.flower].role === 'spike';
            const ratio = Math.hypot(a.x - b.x, a.y - b.y) / (a.radius + b.radius);
            expect(ratio).toBeGreaterThan(spike ? 0.5 : 0.6);
          }
        }
      }
    }
  });

  it('los tallos se recogen cerca del lazo', () => {
    for (const f of compose(memories(30)).flowers)
      expect(Math.abs(f.stemX - 300)).toBeLessThanOrEqual(13);
  });

  it('todos los números del resultado son finitos y se pueden serializar', () => {
    const json = JSON.stringify(compose(memories(100, 5)));
    expect(json).not.toMatch(/null|NaN|Infinity/);
  });
});

describe('Polaroids', () => {
  it('sin fotos no hay Polaroids; el lienzo tiene siempre el mismo alto', () => {
    const layout = compose(memories(8, 0));
    expect(layout.polaroids).toHaveLength(0);
    expect(layout.height).toBe(CANVAS_HEIGHT);
    expect(compose(memories(8, 3)).height).toBe(CANVAS_HEIGHT);
  });

  it('con fotos: como máximo 5, solo de recuerdos con foto y los más recientes', () => {
    const list = memories(12, 7);
    const layout = compose(list);
    expect(layout.polaroids).toHaveLength(MAX_POLAROIDS);
    const withPhoto = [...list]
      .filter((m) => m.hasPhoto)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    expect(layout.polaroids.map((p) => p.id)).toEqual(
      withPhoto.slice(-MAX_POLAROIDS).map((m) => m.id),
    );
  });

  it('con 1 foto hay 1 Polaroid y las Polaroids caben en el lienzo', () => {
    expect(compose(memories(4, 1)).polaroids).toHaveLength(1);
    for (const p of compose(memories(30, 5)).polaroids) {
      expect(p.x - p.w / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w / 2).toBeLessThanOrEqual(CANVAS_WIDTH);
      expect(p.y - p.h / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + p.h / 2).toBeLessThanOrEqual(CANVAS_HEIGHT);
    }
  });

  it('las Polaroids van en el borde del ramo: no tapan el centro de ninguna flor ni el lazo', () => {
    for (const n of [1, 3, 8, 21, 30]) {
      for (let k = 0; k < 20; k++) {
        const layout = compose(memories(n, 5, `pol${k}`));
        for (const p of layout.polaroids) {
          for (const f of layout.flowers) {
            const inside = Math.abs(f.x - p.x) < p.w / 2 && Math.abs(f.y - p.y) < p.h / 2;
            expect(inside).toBe(false);
          }
          const overBow = Math.abs(p.x - layout.base.x) < 64 && p.y + p.h / 2 > layout.base.y - 40;
          expect(overBow).toBe(false);
        }
      }
    }
  });

  it('una foto de un recuerdo agrupado en «+N más» también puede ser Polaroid', () => {
    const layout = compose(memories(100, 5));
    expect(layout.polaroids).toHaveLength(5);
    expect(MAX_FLOWERS).toBe(21);
  });
});
