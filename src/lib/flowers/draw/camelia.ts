import {
  layerGradient,
  ring,
  shadeCircle,
  speckles,
  sepals,
  type HeadDrawer,
  type Palette,
  pastelSet,
} from './common';
import { f } from '../svg';

const PALETTES = pastelSet([
  { dark: '#e08aa5', mid: '#f4b8c8', light: '#fdeff3', edge: '#b4607a' },
  { dark: '#e7a4b8', mid: '#f9d4de', light: '#fffafb', edge: '#b4607a' },
  { dark: '#dd7b97', mid: '#f0a5b8', light: '#fbe0e7', edge: '#a8506c' },
]);

const PETAL = 'M0 0C-25-2-32-24-17-35C-8-42 8-42 17-35C32-24 25-2 0 0Z';
const VEINS = 'M0-4C-4-16-9-28-12-33M0-4C0-16 0-28 0-37M0-4C4-16 9-28 12-33';

export const drawCamelia: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  o.defs.shape('camelia-petal', PETAL);
  const base = {
    shape: 'camelia-petal',
    edge: p.edge,
    edgeOpacity: 0.45,
    veins: VEINS,
    scaleJitter: 0.08,
  } as const;
  let body = sepals(o, 29, 4, 30);
  body += ring(o, {
    ...base,
    n: 7,
    offset: 0,
    scale: 0.88,
    fill: layerGradient(o, 'camelia', p, 0),
  });
  body += shadeCircle(o, 'camelia', 28, '#8a3a55', 0.22);
  body += ring(o, {
    ...base,
    n: 6,
    offset: 26,
    scale: 0.68,
    fill: layerGradient(o, 'camelia', p, 1),
  });
  body += shadeCircle(o, 'camelia', 21, '#8a3a55', 0.22);
  body += ring(o, {
    ...base,
    n: 5,
    offset: 8,
    scale: 0.5,
    fill: layerGradient(o, 'camelia', p, 2),
  });
  body += ring(o, {
    ...base,
    n: 4,
    offset: 40,
    scale: 0.32,
    fill: layerGradient(o, 'camelia', p, 3),
  });
  const n = o.detail === 'icon' ? 6 : o.detail === 'lite' ? 10 : 16;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + o.rng() * 0.3;
    const d = 5 + o.rng() * 4;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    if (o.detail === 'full') {
      body += `<path d="M0 0L${f(x)} ${f(y)}" stroke="#d9a441" stroke-width=".7" stroke-linecap="round"/>`;
    }
    body += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.5 + o.rng() * 0.6)}" fill="${i % 2 ? '#f1c968' : '#d9a441'}"/>`;
  }
  body += speckles(o, 14, 30, p.edge);
  return { body, radius: 37, attach: { x: 0, y: 30 }, leaf: 'lance' };
};
