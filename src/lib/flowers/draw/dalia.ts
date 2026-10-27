import {
  layerGradient,
  ring,
  shadeCircle,
  speckles,
  sepals,
  type HeadDrawer,
  type Palette,
} from './common';

const PALETTES: readonly [Palette, Palette, Palette] = [
  { dark: '#7d2f6e', mid: '#c0529a', light: '#efb4d6', edge: '#6b2860' },
  { dark: '#6a3f98', mid: '#a97bd0', light: '#e3cdf3', edge: '#55307d' },
  { dark: '#92305f', mid: '#d0608c', light: '#f4bdd3', edge: '#7a2750' },
];

const PETAL = 'M0 0C-10-5-12-26 0-42C12-26 10-5 0 0Z';

export const drawDalia: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  o.defs.shape('dalia-petal', PETAL);
  const base = {
    shape: 'dalia-petal',
    edge: p.edge,
    edgeOpacity: 0.5,
    edgeWidth: 1,
    veins: 'M0-4C0-16 0-30 0-38',
    shine: 'M-6-14C-8-24-6-32-2-37',
    angleJitter: 8,
    scaleJitter: 0.1,
  } as const;
  let body = sepals(o, 33, 5, 24);
  body += ring(o, {
    ...base,
    n: 13,
    offset: 0,
    scale: 0.98,
    fill: layerGradient(o, 'dalia', p, 0),
  });
  body += ring(o, {
    ...base,
    n: 13,
    offset: 13.8,
    scale: 0.84,
    fill: layerGradient(o, 'dalia', p, 1),
  });
  body += shadeCircle(o, 'dalia', 28, '#3d1238', 0.3);
  body += ring(o, {
    ...base,
    n: 11,
    offset: 0,
    scale: 0.66,
    fill: layerGradient(o, 'dalia', p, 2),
  });
  body += ring(o, { ...base, n: 9, offset: 20, scale: 0.5, fill: layerGradient(o, 'dalia', p, 3) });
  body += shadeCircle(o, 'dalia', 16, '#3d1238', 0.25);
  body += ring(o, { ...base, n: 7, offset: 0, scale: 0.34, fill: layerGradient(o, 'dalia', p, 4) });
  body += ring(o, { ...base, n: 5, offset: 30, scale: 0.2, fill: layerGradient(o, 'dalia', p, 5) });
  body += speckles(o, 26, 34, p.edge);
  return { body, radius: 40, attach: { x: 0, y: 34 }, leaf: 'lance' };
};
