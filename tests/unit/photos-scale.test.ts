import { describe, expect, it } from 'vitest';
import { fitWithin } from '@/lib/photos/scale';

describe('fitWithin', () => {
  it('reduce el lado largo conservando la proporción', () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(3000, 3000, 480)).toEqual({ width: 480, height: 480 });
  });
  it('nunca amplía', () => {
    expect(fitWithin(300, 200, 2048)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(2048, 100, 2048)).toEqual({ width: 2048, height: 100 });
  });
  it('mantiene al menos 1 px en el lado corto', () => {
    expect(fitWithin(1, 5000, 2048)).toEqual({ width: 1, height: 2048 });
  });
});
