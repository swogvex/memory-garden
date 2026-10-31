import {
  WHITE,
  petalDef,
  petalGradient,
  petalRing,
  speckles,
  type HeadDrawer,
  type Palette,
  pastelSet,
} from './common';
import { f, mix } from '../svg';

const PALETTES = pastelSet([
  { dark: '#d9921f', mid: '#f2c94c', light: '#fbeaa8', edge: '#a8741c' },
  { dark: '#c97f12', mid: '#e8ae33', light: '#f8dc90', edge: '#9b6414' },
  { dark: '#e0a82e', mid: '#f7dc66', light: '#fdf3c4', edge: '#b08a22' },
]);

/** Pétalo largo y estrecho, con la punta afilada y un surco central. */
const PETAL = 'M0-14C-6-19-8-30-5-40C-3.5-45-1.5-48 0-50C1.5-48 3.5-45 5-40C8-30 6-19 0-14Z';
const FOLD = 'M0-14C-6-19-8-30-5-40C-3.5-45-1.5-48 0-50C-0.8-38-0.8-25 0-14Z';
const VEIN = 'M0-17C0-27 0-37 0-46';
const SHINE = 'M2.5-19C5-27 5-35 2.5-43';

export const drawGirasol: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  const t = o.tone % 3;
  o.defs.shape('girasol-petal', PETAL);
  const back = petalDef(o, `girasol-${t}-back`, {
    shape: 'girasol-petal',
    fill: petalGradient(o, `girasol-${t}-gb`, p.dark, mix(p.mid, p.dark, 0.25), p.mid),
    edge: p.edge,
    edgeOpacity: 0.5,
    edgeWidth: 0.8,
    fold: FOLD,
    foldOpacity: 0.18,
  });
  const front = petalDef(o, `girasol-${t}-front`, {
    shape: 'girasol-petal',
    fill: petalGradient(
      o,
      `girasol-${t}-gf`,
      mix(p.dark, p.mid, 0.4),
      p.mid,
      mix(p.light, WHITE, 0.1),
    ),
    edge: p.edge,
    edgeOpacity: 0.5,
    edgeWidth: 0.8,
    fold: FOLD,
    foldOpacity: 0.16,
    vein: VEIN,
    shine: SHINE,
    shineOpacity: 0.5,
  });
  const n = o.detail === 'icon' ? 14 : 21;
  const spin = o.rng() * (360 / n);
  let body = petalRing(o, back, n, spin + 180 / n, 0.94, 3);
  body += petalRing(o, front, n, spin, 1, 3);

  // Disco: borde de flores amarillas, anillo verdoso y centro de semillas en espiral.
  o.defs.radial(
    'girasol-disc',
    [
      [0, '#2f1d10'],
      [0.55, '#553219'],
      [0.85, '#7a4c22'],
      [1, '#9a6a2c'],
    ],
    45,
    42,
    58,
  );
  body += `<circle r="20" fill="${o.defs.ref('girasol-disc')}" stroke="#3b2415" stroke-opacity=".6" stroke-width="1"/>`;
  if (o.detail === 'icon') {
    body += `<circle r="10" fill="#2a180d" fill-opacity=".45"/>`;
  } else {
    body += `<circle r="17" fill="none" stroke="#e8b54a" stroke-opacity=".55" stroke-width="2.6" stroke-dasharray="1.3 2.1"/>`;
    body += `<circle r="13.6" fill="none" stroke="#8a9a3c" stroke-opacity=".3" stroke-width="1.6" stroke-dasharray="1 1.8"/>`;
  }
  if (o.detail === 'full') {
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    let seeds = '';
    for (let i = 1; i <= 60; i++) {
      const d = 12.5 * Math.sqrt(i / 60);
      const a = i * GOLDEN;
      seeds += `<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d)}" r="${f(0.55 + (i / 60) * 0.5)}"/>`;
    }
    body += `<g fill="#c8924a" fill-opacity=".55">${seeds}</g>`;
  }
  if (o.detail !== 'icon') {
    body += `<path d="M-11-9C-7-14 0-15 5-13" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  body += speckles(o, 10, 44, p.edge);
  return { body, radius: 48, attach: { x: 0, y: 40 }, leaf: 'broad' };
};
