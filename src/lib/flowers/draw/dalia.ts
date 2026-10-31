import {
  WHITE,
  petalDef,
  petalGradient,
  petalRing,
  shadeCircle,
  type HeadDrawer,
  type Palette,
  pastelSet,
} from './common';
import { mix } from '../svg';

const PALETTES = pastelSet([
  { dark: '#8d3a7c', mid: '#c95fa3', light: '#f3c3de', edge: '#6b2860' },
  { dark: '#6a3f98', mid: '#a97bd0', light: '#e6d3f5', edge: '#55307d' },
  { dark: '#a23a68', mid: '#d86c95', light: '#f7c8da', edge: '#7a2750' },
]);

/** Pétalo puntiagudo y acanalado: la mitad izquierda queda en sombra, como un pliegue. */
const PETAL = 'M0 0C-8-5-10-20-6-31C-4-36-2-39 0-41C2-39 4-36 6-31C10-20 8-5 0 0Z';
const FOLD = 'M0 0C-8-5-10-20-6-31C-4-36-2-39 0-41C-1-30-1-14 0 0Z';
const VEIN = 'M0-3C0-14 0-26 0-37';
/** Pétalo interior: corto, ancho y redondeado, como una cuchara cerrada. */
const CUP = 'M0 0C-9-4-11-18-8-28C-6-34-3-37 0-37C3-37 6-34 8-28C11-18 9-4 0 0Z';
const CUP_FOLD = 'M0 0C-9-4-11-18-8-28C-6-34-3-37 0-37C-1-26-1-12 0 0Z';
const SHINE = 'M3-6C6-16 6-26 2-35';

/** Capas de fuera a dentro: [pétalos, escala, desfase en grados]. */
const LAYERS: readonly (readonly [number, number, number])[] = [
  [15, 1, 0],
  [15, 0.86, 12],
  [13, 0.74, 4],
  [11, 0.64, 17],
  [9, 0.52, 8],
  [7, 0.4, 25],
  [5, 0.28, 10],
];

export const drawDalia: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  const t = o.tone % 3;
  o.defs.shape('dalia-petal', PETAL);
  o.defs.shape('dalia-cup', CUP);
  const layers = o.detail === 'icon' ? LAYERS.filter((_, i) => i % 2 === 0) : LAYERS;
  const spin = o.rng() * 20;
  let body = '';
  layers.forEach(([n, scale, offset], i) => {
    // Las capas interiores, más intensas en la base y más claras en la punta.
    const k = i / (layers.length - 1);
    const inner = scale < 0.7;
    const key = petalDef(o, `dalia-${t}-p${i}`, {
      shape: inner ? 'dalia-cup' : 'dalia-petal',
      fill: petalGradient(
        o,
        `dalia-${t}-g${i}`,
        mix(p.dark, p.mid, 0.15 + k * 0.2),
        mix(p.mid, p.light, 0.25 + k * 0.2),
        mix(p.light, WHITE, 0.25 + k * 0.25),
      ),
      edge: p.edge,
      edgeOpacity: 0.42,
      edgeWidth: 0.8,
      fold: inner ? CUP_FOLD : FOLD,
      foldColor: p.edge,
      foldOpacity: inner ? 0.14 : 0.2,
      vein: VEIN,
      ...(inner ? {} : { shine: SHINE }),
      shineOpacity: 0.4,
    });
    body += petalRing(o, key, n, spin + offset, scale, 1.5);
    if (i === 1 || i === 3) body += shadeCircle(o, 'dalia', 40 * scale * 0.82, p.dark, 0.28);
  });
  // Botón central todavía cerrado.
  o.defs.radial(
    `dalia-${t}-eye`,
    [
      [0, mix(p.light, '#fff6d8', 0.5)],
      [1, p.mid],
    ],
    45,
    40,
    70,
  );
  body += `<circle r="${o.detail === 'icon' ? 4 : 3.2}" fill="${o.defs.ref(`dalia-${t}-eye`)}" stroke="${p.edge}" stroke-opacity=".4" stroke-width=".5"/>`;
  return { body, radius: 40, attach: { x: 0, y: 34 }, leaf: 'lance' };
};
