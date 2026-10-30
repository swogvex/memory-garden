import { f } from '@/lib/flowers';
import type { StemCurve } from './model';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Punto de la parte curva del tallo (cabeza → lazo) en `t` ∈ [0, 1]. */
export function stemPoint(s: StemCurve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * s.x0 + b * s.c1x + c * s.c2x + d * s.x1,
    y: a * s.y0 + b * s.c1y + c * s.c2y + d * s.y1,
  };
}

/** Derivada de la parte curva en `t` (apunta de la cabeza hacia el lazo). */
export function stemTangent(s: StemCurve, t: number): Point {
  const u = 1 - t;
  return {
    x: 3 * u * u * (s.c1x - s.x0) + 6 * u * t * (s.c2x - s.c1x) + 3 * t * t * (s.x1 - s.c2x),
    y: 3 * u * u * (s.c1y - s.y0) + 6 * u * t * (s.c2y - s.c1y) + 3 * t * t * (s.y1 - s.c2y),
  };
}

/** Ángulo de un vector en grados con 0 = arriba y positivo en sentido horario (como `rotate()`). */
export const headingDeg = (v: Point): number => (Math.atan2(v.x, -v.y) * 180) / Math.PI;

/** Atributo `d` del tallo completo (curva + tramo bajo el lazo). */
export function stemPath(s: StemCurve): string {
  return `M${f(s.x0)} ${f(s.y0)}C${f(s.c1x)} ${f(s.c1y)} ${f(s.c2x)} ${f(s.c2y)} ${f(s.x1)} ${f(s.y1)}L${f(s.ex)} ${f(s.ey)}`;
}
