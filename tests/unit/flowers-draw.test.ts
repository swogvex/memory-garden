import { describe, expect, it } from 'vitest';
import {
  Defs,
  FLOWER_IDS,
  FLOWER_INFO,
  HEADS,
  esc,
  f,
  makeRng,
  mix,
  renderFlower,
  type Detail,
  type FlowerId,
} from '@/lib/flowers';

const DETAILS: readonly Detail[] = ['icon', 'lite', 'full'];
const TONES = [0, 1, 2] as const;

function draw(id: FlowerId, seed: string, detail: Detail, tone: number) {
  const defs = new Defs('t-');
  const head = HEADS[id]({ rng: makeRng(seed), defs, detail, tone });
  return { head, defs: String(defs), doc: `${defs}${head.body}` };
}

/** Ids definidos y referencias (`url(#…)`, `href="#…"`) de un documento SVG. */
function ids(doc: string) {
  const defined = [...doc.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);
  const used = [
    ...[...doc.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1] as string),
    ...[...doc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1] as string),
  ];
  return { defined, used };
}

describe('dibujo de las cabezas', () => {
  it('cada flor, tono y nivel de detalle produce SVG no vacío', () => {
    for (const id of FLOWER_IDS) {
      for (const detail of DETAILS) {
        for (const tone of TONES) {
          expect(draw(id, 'semilla', detail, tone).head.body.length).toBeGreaterThan(200);
        }
      }
    }
  });

  it('la misma semilla da exactamente el mismo dibujo; otra semilla, otro', () => {
    for (const id of FLOWER_IDS) {
      const a = draw(id, 'mes|a', 'full', 0);
      expect(draw(id, 'mes|a', 'full', 0).doc).toBe(a.doc);
      expect(draw(id, 'mes|b', 'full', 0).doc).not.toBe(a.doc);
    }
  });

  it('los tres tonos de cada flor son distintos', () => {
    for (const id of FLOWER_IDS) {
      const docs = TONES.map((t) => draw(id, 's', 'full', t).doc);
      expect(new Set(docs).size).toBe(3);
    }
  });

  it('el radio y la hoja que declara cada cabeza coinciden con el catálogo', () => {
    for (const id of FLOWER_IDS) {
      const { head } = draw(id, 's', 'full', 0);
      expect(head.radius).toBe(FLOWER_INFO[id].radius);
      expect(head.leaf).toBe(FLOWER_INFO[id].leaf);
    }
  });

  it('menos detalle pesa menos', () => {
    for (const id of FLOWER_IDS) {
      const [icon, lite, full] = DETAILS.map((d) => draw(id, 's', d, 0).doc.length) as [
        number,
        number,
        number,
      ];
      expect(icon).toBeLessThan(full);
      expect(lite).toBeLessThanOrEqual(full);
    }
  });

  it('no usa filtros, estilos en línea, scripts ni recursos externos (D-086, D-149)', () => {
    for (const id of FLOWER_IDS) {
      const { doc } = draw(id, 's', 'full', 1);
      expect(doc).not.toMatch(/\sstyle\s*=/i);
      expect(doc).not.toMatch(/<filter|filter=|feTurbulence|feDisplacementMap/i);
      expect(doc).not.toMatch(/<script|<foreignObject|<image|javascript:|\son[a-z]+\s*=|https?:/i);
    }
  });

  it('los ids son únicos y toda referencia apunta a algo definido', () => {
    for (const id of FLOWER_IDS) {
      for (const detail of DETAILS) {
        const { defined, used } = ids(draw(id, 's', detail, 2).doc);
        expect(new Set(defined).size).toBe(defined.length);
        for (const u of used) expect(defined.includes(u)).toBe(true);
        for (const d of defined) expect(d.startsWith('t-')).toBe(true);
      }
    }
  });

  it('los números salen finitos: sin NaN ni Infinity en ningún dibujo', () => {
    for (const id of FLOWER_IDS) {
      for (const tone of TONES) expect(draw(id, 'x', 'full', tone).doc).not.toMatch(/NaN|Infinity/);
    }
  });

  it('presupuesto: las 8 cabezas a detalle completo caben en 130 KiB sin comprimir', () => {
    // Medido en Node al cerrar H6.1: ~103 KiB (tono 0). El tope deja margen y avisa de regresiones.
    const total = FLOWER_IDS.reduce((sum, id) => sum + draw(id, 'x', 'full', 0).doc.length, 0);
    expect(total).toBeLessThan(130 * 1024);
  });
});

describe('flor suelta (renderFlower)', () => {
  it('con tallo es un SVG completo y determinista', () => {
    for (const id of FLOWER_IDS) {
      const svg = renderFlower(id, { seed: 'a', stem: true, idPrefix: 'q-' });
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).toBe(renderFlower(id, { seed: 'a', stem: true, idPrefix: 'q-' }));
      const { defined, used } = ids(svg);
      for (const u of used) expect(defined.includes(u)).toBe(true);
    }
  });
});

describe('utilidades de SVG', () => {
  it('f redondea a 2 decimales, evita -0 y rechaza lo no finito', () => {
    expect(f(1.23456)).toBe('1.23');
    expect(f(-0.001)).toBe('0');
    expect(() => f(Number.NaN)).toThrow();
    expect(() => f(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('esc escapa lo peligroso en atributos y texto', () => {
    expect(esc(`<script>"a" & 'b'</script>`)).toBe(
      "&lt;script&gt;&quot;a&quot; &amp; 'b'&lt;/script&gt;",
    );
  });

  it('mix interpola colores y rechaza formatos raros', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#112233', '#112233', 0.7)).toBe('#112233');
    expect(() => mix('red', '#ffffff', 0.5)).toThrow();
  });

  it('Defs rechaza prefijos y claves con caracteres que romperían un id', () => {
    expect(() => new Defs('a b')).toThrow();
    expect(() => new Defs('"x')).toThrow();
    expect(() => new Defs('ok-').id('a"b')).toThrow();
  });

  it('Defs es idempotente por clave', () => {
    const d = new Defs('p-');
    d.shape('k', 'M0 0L1 1');
    d.shape('k', 'M9 9L9 9');
    expect(d.size).toBe(1);
    expect(String(d)).toContain('M0 0L1 1');
  });
});
