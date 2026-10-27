import type { LeafKind } from './draw/common';
import { Defs, f, type Detail } from './svg';

/** Hojas apuntando hacia arriba (−y), con la base en el origen. Longitud nominal en el comentario. */
const LEAVES: Record<LeafKind, { d: string; rib: string; veins: string }> = {
  /* 40 */ lance: {
    d: 'M0 0C-8-8-11-24-2-40C9-26 8-8 0 0Z',
    rib: 'M0-2C-1-14-1-26-2-37',
    veins: 'M-1-10L-6-17M-1-17L5-23M-1.5-23L-6-29M-1.5-29L3-33',
  },
  /* 42 */ broad: {
    d: 'M0 0C-17-6-23-26-4-42C15-30 19-8 0 0Z',
    rib: 'M0-2C-1-16-2-30-4-39',
    veins: 'M-1-10L-10-16M-1-10L8-15M-2-20L-11-26M-2-20L9-25M-3-29L-9-34M-3-29L5-33',
  },
  /* 62 */ strap: {
    d: 'M0 0C-5-12-4-36 1-62C6-36 5-12 0 0Z',
    rib: 'M0-3C0-20 1-40 1-58',
    veins: '',
  },
};

export const LEAF_LENGTH: Record<LeafKind, number> = { lance: 40, broad: 42, strap: 62 };

const GREENS: readonly (readonly [string, string, string])[] = [
  ['#4a6444', '#6f8a66', '#9db592'],
  ['#52704f', '#7a9671', '#a8bf9d'],
  ['#4d6a52', '#6c8c78', '#9dbaa6'],
];

export const STEM_COLOR = '#5f7a57';

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
  let inner = `<use href="${defs.use(`leaf-${kind}`)}" fill="${leafGradient(defs, tone)}" stroke="#2f4a2e" stroke-opacity=".4" stroke-width="${f(0.8 / k)}"/>`;
  if (detail !== 'icon') {
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
