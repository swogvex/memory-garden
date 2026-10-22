import type { Size } from './size';

/** Reduce hasta que el lado largo sea ≤ `maxSide`, conservando la proporción. Nunca amplía. */
export function fitWithin(width: number, height: number, maxSide: number): Size {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const k = maxSide / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
