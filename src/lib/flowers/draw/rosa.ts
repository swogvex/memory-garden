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
  { dark: '#b84d6c', mid: '#e07f9b', light: '#f6cdd7', edge: '#8f3a55' },
  { dark: '#a8405f', mid: '#d86b89', light: '#f2b9c8', edge: '#822f4b' },
  { dark: '#c9708a', mid: '#eaa2b5', light: '#fbe2e8', edge: '#9a4a62' },
];

const PETAL = 'M0 0C-21-3-27-26-13-38C-6-44 6-44 13-38C27-26 21-3 0 0Z';
const VEINS = 'M0 -4C-1-16-1-28 0-38M-7 -8C-9-18-9-26-7-33M7 -8C9-18 9-26 7-33';
const SHINE = 'M-12 -37C-5-42.5 5-42.5 12-37';

export const drawRosa: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  o.defs.shape('rosa-petal', PETAL);
  const base = { shape: 'rosa-petal', edge: p.edge, veins: VEINS, shine: SHINE } as const;
  const outer = 5 + (o.rng() > 0.6 ? 1 : 0);
  let body = sepals(o, 30);
  body += ring(o, {
    ...base,
    n: outer,
    offset: 0,
    scale: 0.86,
    fill: layerGradient(o, 'rosa', p, 0),
  });
  body += shadeCircle(o, 'rosa', 27, '#6e2a40', 0.3);
  body += ring(o, { ...base, n: 5, offset: 36, scale: 0.64, fill: layerGradient(o, 'rosa', p, 1) });
  body += shadeCircle(o, 'rosa', 18, '#6e2a40', 0.3);
  body += ring(o, { ...base, n: 4, offset: 10, scale: 0.44, fill: layerGradient(o, 'rosa', p, 2) });
  body += ring(o, { ...base, n: 3, offset: 60, scale: 0.26, fill: layerGradient(o, 'rosa', p, 3) });
  if (o.detail !== 'icon') {
    body += `<path d="M0 3.5C-4.5 3.5-5.5-2-1-3C4.5-4 6.5 2.5 2 5.5C-3.5 8.5-8.5 3-6.5-2.5" fill="none" stroke="#6e2a40" stroke-opacity=".55" stroke-width="1" stroke-linecap="round"/>`;
  }
  body += speckles(o, 34, 33, p.edge);
  return { body, radius: 38, attach: { x: 0, y: 32 }, leaf: 'lance' };
};
