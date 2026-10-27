import { describe, expect, it } from 'vitest';
import {
  EXPORT_MAX_PIXELS,
  EXPORT_MAX_SIDE,
  chooseScale,
  composeBouquet,
  coverRect,
  exportFileName,
  planExport,
} from '@/features/bouquets';

const mems = (n: number, photos = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${String(i).padStart(3, '0')}`,
    date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
    flower: 'rosa' as const,
    hasPhoto: i < photos,
  }));
const layout = (n: number, photos = 0) =>
  composeBouquet({ month: '2026-10', memories: mems(n, photos) });

describe('exportación a PNG (plan)', () => {
  it('2400 px de ancho y dentro de los topes, con y sin fotos', () => {
    for (const [n, p] of [
      [0, 0],
      [1, 0],
      [8, 3],
      [30, 5],
      [100, 5],
    ] as const) {
      const plan = planExport(layout(n, p));
      expect(plan.canvasWidth).toBe(2400);
      expect(plan.canvasHeight).toBeLessThanOrEqual(EXPORT_MAX_SIDE);
      expect(plan.canvasWidth * plan.canvasHeight).toBeLessThanOrEqual(EXPORT_MAX_PIXELS);
      expect(plan.scale).toBe(4);
    }
  });
  it('una foto por Polaroid, con el margen superior; «+N más» solo si hay desbordamiento', () => {
    const l = layout(30, 5);
    const plan = planExport(l);
    expect(plan.photos.length).toBe(l.polaroids.length);
    expect(plan.photos[0]!.y).toBe(l.polaroids[0]!.y + 24);
    expect(plan.overflow).not.toBeNull();
    expect(planExport(layout(8)).overflow).toBeNull();
  });
  it('es determinista', () => {
    expect(JSON.stringify(planExport(layout(8, 3)))).toBe(JSON.stringify(planExport(layout(8, 3))));
  });
  it('la escala baja si el lienzo no cabe', () => {
    expect(chooseScale(600, 910)).toBe(4);
    const s = chooseScale(600, 2600, 4800);
    expect(600 * s * 2600 * s).toBeLessThanOrEqual(EXPORT_MAX_PIXELS);
    expect(chooseScale(600, 100_000)).toBe(1);
  });
});

describe('nombre de archivo y recorte', () => {
  it('nombre seguro', () => {
    expect(exportFileName('2026-10')).toBe('ramo-2026-10.png');
    for (const bad of ['../../x', '2026-13', 'a b', '', '2026-10\\..']) {
      expect(exportFileName(bad)).toBe('ramo.png');
    }
  });
  it('cover: llena el hueco sin deformar y centra', () => {
    const c = coverRect(400, 200, 100, 100);
    expect(c).toEqual({ sx: 100, sy: 0, sw: 200, sh: 200 });
    expect(coverRect(100, 400, 100, 100)).toEqual({ sx: 0, sy: 150, sw: 100, sh: 100 });
    expect(coverRect(0, 10, 10, 10)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});
