import { layerGradient, ring, speckles, type HeadDrawer, type Palette, pastelSet } from './common';
import { f } from '../svg';

const PALETTES = pastelSet([
  { dark: '#ead9ae', mid: '#fbf4e2', light: '#ffffff', edge: '#a99a78' },
  { dark: '#e9d3d9', mid: '#fbeef1', light: '#ffffff', edge: '#a98490' },
  { dark: '#e1d6f0', mid: '#f6f1fb', light: '#ffffff', edge: '#8f80a8' },
]);

const PETAL = 'M0-7C-6.5-12-7.5-30-3.5-39C-2-42.5 2-42.5 3.5-39C7.5-30 6.5-12 0-7Z';

export const drawMargarita: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  o.defs.shape('margarita-petal', PETAL);
  const base = {
    shape: 'margarita-petal',
    edge: p.edge,
    edgeOpacity: 0.55,
    veins: 'M0-10C0-20 0-30 0-37',
    scaleJitter: 0.06,
    angleJitter: 4,
  } as const;
  const n = 14 + Math.floor(o.rng() * 3);
  let body = ring(o, {
    ...base,
    n,
    offset: 180 / n,
    scale: 0.95,
    fill: layerGradient(o, 'margarita', p, 0),
  });
  body += ring(o, { ...base, n, offset: 0, scale: 1, fill: layerGradient(o, 'margarita', p, 1) });
  o.defs.radial(
    'margarita-core',
    [
      [0, '#b9772a'],
      [0.6, '#d9a441'],
      [1, '#f1c968'],
    ],
    50,
    55,
    60,
  );
  body += `<circle r="10" fill="${o.defs.ref('margarita-core')}" stroke="#a8742a" stroke-opacity=".6" stroke-width="1"/>`;
  if (o.detail !== 'icon') {
    body += `<circle r="6" fill="none" stroke="#8a5a1f" stroke-opacity=".3" stroke-width=".8" stroke-dasharray="1.2 2"/>`;
    body += `<path d="M-6-4C-3-8 3-8 6-4" fill="none" stroke="#fff6d6" stroke-opacity=".6" stroke-width="1.2" stroke-linecap="round"/>`;
  }
  if (o.detail === 'full') {
    for (let i = 0; i < 16; i++) {
      const a = o.rng() * Math.PI * 2;
      const d = Math.sqrt(o.rng()) * 8;
      body += `<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(0.5 + o.rng() * 0.5)}" fill="#7a4b1c" fill-opacity=".45"/>`;
    }
  }
  body += speckles(o, 10, 36, p.edge);
  return { body, radius: 42, attach: { x: 0, y: 30 }, leaf: 'lance' };
};
