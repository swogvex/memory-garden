import type { LeafKind } from './draw/common';
import { Defs, f, mix, type Detail } from './svg';

/**
 * Hojas apuntando hacia arriba (−y), con la base en el origen y la punta algo curvada.
 * `half` es la mitad en sombra (da volumen a lo largo del nervio). Longitud nominal en el comentario.
 */
const LEAVES: Record<LeafKind, { d: string; half: string; rib: string; veins: string }> = {
  /* 40 */ lance: {
    d: 'M0 0C-7-6-10-18-6-30C-4-35-1.5-38 1-40C5-31 7-18 4-9C3-5 1.5-2 0 0Z',
    half: 'M0 0C-7-6-10-18-6-30C-4-35-1.5-38 1-40C0.5-27 0.3-13 0 0Z',
    rib: 'M0-1.5C0.4-13 0.7-26 0.9-37',
    veins:
      'M0.2-9L-4.5-14M0.4-16L-4.6-21.5M0.6-23L-3.6-28M0.3-11L3.8-15M0.5-18L4.2-22.5M0.7-25L3.3-29',
  },
  /* 42 */ broad: {
    d: 'M0 0C-14-4-21-17-17-29C-14-37-6-41 1-42C9-36 16-26 14-14C12-5 6-1 0 0Z',
    half: 'M0 0C-14-4-21-17-17-29C-14-37-6-41 1-42C0.6-28 0.3-14 0 0Z',
    rib: 'M0-2C0.3-15 0.6-28 0.9-39',
    veins:
      'M0.2-8L-9-13M0.4-16L-11-21M0.6-24L-9-29M0.7-31L-5-35M0.2-10L8-14M0.4-18L10-22M0.6-26L8-30',
  },
  /* 62 */ strap: {
    d: 'M0 0C-5-12-5-34-1-55C0-59 1-62 2-62C5-40 5-14 0 0Z',
    half: 'M0 0C-5-12-5-34-1-55C0-59 1-62 2-62C1.3-40 0.6-20 0 0Z',
    rib: 'M0-3C0.5-20 1.2-40 1.8-58',
    veins: '',
  },
};

export const LEAF_LENGTH: Record<LeafKind, number> = { lance: 40, broad: 42, strap: 62 };

/** Verdes salvia suavizados hacia el papel (pastel, H7.5). */
const PAPER = '#fbf8f2';
const softGreen = (c: string, t: number) => mix(c, PAPER, t);
const GREENS: readonly (readonly [string, string, string])[] = [
  ['#4a6444', '#6f8a66', '#9db592'],
  ['#52704f', '#7a9671', '#a8bf9d'],
  ['#4d6a52', '#6c8c78', '#9dbaa6'],
].map(
  ([a, b, c]) =>
    [
      softGreen(a as string, 0.2),
      softGreen(b as string, 0.18),
      softGreen(c as string, 0.12),
    ] as const,
);

export const STEM_COLOR = '#74896b';

function leafGradient(defs: Defs, tone: number): string {
  const g = GREENS[tone % 3] as readonly [string, string, string];
  const key = `leaf-${tone % 3}`;
  defs.radial(key, [
    [0, g[0]],
    [0.6, g[1]],
    [1, g[2]],
  ]);
  return defs.ref(key);
}

/** Una hoja de `length` unidades de largo, con su base en (x, y) y girada `rot` grados. */
export function leaf(
  defs: Defs,
  detail: Detail,
  kind: LeafKind,
  x: number,
  y: number,
  rot: number,
  length: number,
  tone: number,
): string {
  const spec = LEAVES[kind];
  defs.shape(`leaf-${kind}`, spec.d);
  const k = length / LEAF_LENGTH[kind];
  let inner = `<use href="${defs.use(`leaf-${kind}`)}" fill="${leafGradient(defs, tone)}" stroke="#2f4a2e" stroke-opacity=".38" stroke-width="${f(0.8 / k)}" stroke-linejoin="round"/>`;
  if (detail !== 'icon') {
    inner += `<path d="${spec.half}" fill="#2f4a2e" fill-opacity=".12"/>`;
    inner += `<path d="${spec.rib}" fill="none" stroke="#e1ead9" stroke-opacity=".7" stroke-width="${f(1 / k)}" stroke-linecap="round"/>`;
  }
  if (detail === 'full' && spec.veins) {
    inner += `<path d="${spec.veins}" fill="none" stroke="#e1ead9" stroke-opacity=".4" stroke-width="${f(0.7 / k)}" stroke-linecap="round"/>`;
  }
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(k)})">${inner}</g>`;
}

/** Tallo curvo entre dos puntos; `bow` curva la línea hacia un lado (en unidades). */
export function stem(
  detail: Detail,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  bow = 0,
): string {
  const dy = by - ay;
  const c1x = ax + bow;
  const c1y = ay + dy * 0.38;
  const c2x = bx + (ax - bx) * 0.25 + bow * 0.4;
  const c2y = by - dy * 0.3;
  const d = `M${f(ax)} ${f(ay)}C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(bx)} ${f(by)}`;
  let out = `<path d="${d}" fill="none" stroke="${STEM_COLOR}" stroke-width="${f(width)}" stroke-linecap="round"/>`;
  if (detail === 'full') {
    out += `<path d="${d}" fill="none" stroke="#a8bf9d" stroke-opacity=".5" stroke-width="${f(width * 0.28)}" stroke-linecap="round" transform="translate(${f(-width * 0.18)} 0)"/>`;
  }
  return out;
}
