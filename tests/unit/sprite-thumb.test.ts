import { describe, expect, it } from 'vitest';
import { composeBouquet, renderBouquetThumb } from '@/features/bouquets';
import { FLOWER_IDS, renderFlowerSprite, spriteId } from '@/lib/flowers';

const sprite = renderFlowerSprite();
const ids = [...sprite.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);
const memories = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${String(i).padStart(3, '0')}`,
    date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
    flower: FLOWER_IDS[i % FLOWER_IDS.length]!,
    hasPhoto: i % 3 === 0,
  }));
const thumb = (n: number) =>
  renderBouquetThumb(composeBouquet({ month: '2026-10', memories: memories(n) }));

describe('sprite de flores', () => {
  it('trae las 8 flores, con ids únicos y sin elementos prohibidos', () => {
    for (const id of FLOWER_IDS) expect(ids.includes(spriteId(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      /<(script|style|filter|image|foreignObject)|style=|on\w+=|href="(?!#)/i.test(sprite),
    ).toBe(false);
  });
  it('es estable y pesa poco', () => {
    expect(renderFlowerSprite()).toBe(sprite);
    expect(sprite.length).toBeLessThan(60 * 1024);
  });
});

describe('miniatura de ramo', () => {
  it('solo referencia flores que existen en el sprite', () => {
    const svg = thumb(21);
    const refs = [...svg.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBe(21);
    for (const r of refs) expect(ids.includes(r)).toBe(true);
  });
  it('es decorativa, determinista y sin elementos prohibidos', () => {
    const svg = thumb(8);
    expect(svg).toBe(thumb(8));
    expect(svg.includes('aria-hidden="true"')).toBe(true);
    expect(/<(script|style|filter|image|text)|style=|on\w+=/i.test(svg)).toBe(false);
  });
  it('pesos: 100 recuerdos ≤ 12 KiB; mes vacío es un brote', () => {
    expect(thumb(100).length).toBeLessThan(12 * 1024);
    const empty = thumb(0);
    expect(empty.includes('<use')).toBe(false);
    expect(empty.includes('<path')).toBe(true);
  });
});
