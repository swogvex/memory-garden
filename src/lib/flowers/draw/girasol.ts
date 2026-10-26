import { layerGradient, ring, speckles, sepals, type HeadDrawer, type Palette } from './common';
import { f } from '../svg';

const PALETTES: readonly [Palette, Palette, Palette] = [
  { dark: '#d9921f', mid: '#f2c94c', light: '#fae7a0', edge: '#a8741c' },
  { dark: '#c97f12', mid: '#e8ae33', light: '#f7d98a', edge: '#9b6414' },
  { dark: '#e0a82e', mid: '#f7dc66', light: '#fdf3c2', edge: '#b08a22' },
];

const PETAL = 'M0-14C-8-22-9-38 0-48C9-38 8-22 0-14Z';

export const drawGirasol: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  o.defs.shape('girasol-petal', PETAL);
  const base = {
    shape: 'girasol-petal',
    edge: p.edge,
    edgeOpacity: 0.55,
    edgeWidth: 1.1,
    veins: 'M0-18C0-28 0-38 0-44',
    angleJitter: 8,
    scaleJitter: 0.1,
  } as const;
  let body = sepals(o, 38, 5, 28);
  body += ring(o, { ...base, n: 18, offset: 0, scale: 1, fill: layerGradient(o, 'girasol', p, 0) });
  body += ring(o, {
    ...base,
    n: 18,
    offset: 10,
    scale: 0.9,
    fill: layerGradient(o, 'girasol', p, 1),
  });
  o.defs.radial(
    'girasol-disc',
    [
      [0, '#3b2415'],
      [0.6, '#6b3f1f'],
      [1, '#8a5a2b'],
    ],
    50,
    50,
    55,
  );
  body += `<circle r="19" fill="${o.defs.ref('girasol-disc')}" stroke="#3b2415" stroke-opacity=".7" stroke-width="1.2"/>`;
  if (o.detail === 'icon') {
    body += `<circle r="9" fill="#3b2415" fill-opacity=".5"/>`;
  } else {
    body += `<circle r="13.5" fill="none" stroke="#e0a53a" stroke-opacity=".45" stroke-width="2.2" stroke-dasharray="1.2 2.4"/>`;
    body += `<circle r="8.5" fill="none" stroke="#2a180d" stroke-opacity=".4" stroke-width="2" stroke-dasharray="1.1 2.2"/>`;
  }
  if (o.detail === 'full') {
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    for (let i = 1; i <= 46; i++) {
      const d = 17 * Math.sqrt(i / 46);
      const a = i * GOLDEN;
      body += `<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(0.8 + (i / 46) * 0.5)}" fill="${i % 3 ? '#2a180d' : '#d29a4a'}" fill-opacity=".55"/>`;
    }
  }
  body += speckles(o, 12, 42, p.edge);
  return { body, radius: 48, attach: { x: 0, y: 40 }, leaf: 'broad' };
};
