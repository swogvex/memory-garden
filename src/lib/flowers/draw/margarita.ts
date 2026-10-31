import {
  petalDef,
  petalGradient,
  petalRing,
  type HeadDrawer,
  type Palette,
  pastelSet,
} from './common';
import { f, mix } from '../svg';

const PALETTES = pastelSet([
  { dark: '#e3d8b8', mid: '#fbf6ea', light: '#ffffff', edge: '#a99a78' },
  { dark: '#ead2da', mid: '#fcf0f3', light: '#ffffff', edge: '#a98490' },
  { dark: '#ddd3ee', mid: '#f7f3fc', light: '#ffffff', edge: '#8f80a8' },
]);

/** Pétalo fino y largo, con la punta redondeada y una pequeña muesca. */
const PETAL =
  'M0-8C-4-11-5.2-24-4.6-33C-4.3-38-2.6-41-1.2-41.4L0-40.2L1.2-41.4C2.6-41 4.3-38 4.6-33C5.2-24 4-11 0-8Z';
const VEIN = 'M0-11C0-20 0-29 0-37';
const SHINE = 'M-2.6-14C-3.4-22-3.4-30-2.4-36';

export const drawMargarita: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  const t = o.tone % 3;
  o.defs.shape('margarita-petal', PETAL);
  const back = petalDef(o, `margarita-${t}-back`, {
    shape: 'margarita-petal',
    fill: petalGradient(o, `margarita-${t}-gb`, p.dark, mix(p.mid, p.dark, 0.35), p.mid),
    edge: p.edge,
    edgeOpacity: 0.45,
    edgeWidth: 0.7,
  });
  const front = petalDef(o, `margarita-${t}-front`, {
    shape: 'margarita-petal',
    fill: petalGradient(o, `margarita-${t}-gf`, mix(p.dark, p.mid, 0.3), p.mid, p.light),
    edge: p.edge,
    edgeOpacity: 0.45,
    edgeWidth: 0.7,
    vein: VEIN,
    shine: SHINE,
    shineOpacity: 0.9,
  });
  const n = o.detail === 'icon' ? 14 : 18 + Math.floor(o.rng() * 3);
  const spin = o.rng() * (360 / n);
  let body = petalRing(o, back, n, spin + 180 / n, 0.93, 2.5);
  body += petalRing(o, front, n, spin, 1, 2.5);

  // Centro en cúpula: florecillas amarillas apretadas, más oscuras abajo a la derecha.
  o.defs.radial(
    'margarita-core',
    [
      [0, '#fbe27a'],
      [0.5, '#efc040'],
      [0.9, '#d39a28'],
      [1, '#b97d22'],
    ],
    40,
    35,
    70,
  );
  body += `<circle r="${o.detail === 'icon' ? 13 : 10.5}" fill="${o.defs.ref('margarita-core')}" stroke="#a8742a" stroke-opacity=".55" stroke-width=".9"/>`;
  if (o.detail !== 'icon') {
    body += `<circle r="7.5" fill="none" stroke="#9a6a1f" stroke-opacity=".28" stroke-width="1.3" stroke-dasharray="1 1.7"/>`;
    body += `<path d="M-6.5-3.5C-4.5-7.5 1-8.5 4.5-6.5" fill="none" stroke="#fff8dc" stroke-opacity=".8" stroke-width="1.4" stroke-linecap="round"/>`;
  }
  if (o.detail === 'full') {
    let dots = '';
    for (let i = 0; i < 26; i++) {
      const a = o.rng() * Math.PI * 2;
      const d = Math.sqrt(o.rng()) * 8.5;
      dots += `<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(0.45 + o.rng() * 0.45)}"/>`;
    }
    body += `<g fill="#8a5a1f" fill-opacity=".35">${dots}</g>`;
  }
  return { body, radius: 42, attach: { x: 0, y: 30 }, leaf: 'lance' };
};
