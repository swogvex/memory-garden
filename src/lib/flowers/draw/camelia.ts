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
import { f, mix } from '../svg';

const PALETTES = pastelSet([
  { dark: '#e08aa5', mid: '#f4b8c8', light: '#fff1f5', edge: '#b4607a' },
  { dark: '#e7a4b8', mid: '#f9d4de', light: '#fffbfc', edge: '#b97088' },
  { dark: '#dd7b97', mid: '#f0a5b8', light: '#fde4ea', edge: '#a8506c' },
]);

/** Pétalo redondo, ancho y plano, con una muesca suave en el centro del borde. */
const PETAL =
  'M0 0C-17-1-28-14-26-27C-24-37-14-41-6-39C-3-38-1-36 0-35C1-36 3-38 6-39C14-41 24-37 26-27C28-14 17-1 0 0Z';
const VEIN = 'M0-3C-1-14-1-25 0-33M-3-5C-8-14-11-22-13-29M3-5C8-14 11-22 13-29';
const SHINE = 'M-21-30C-17-36-11-38-6-37';

export const drawCamelia: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  const t = o.tone % 3;
  o.defs.shape('camelia-petal', PETAL);
  const keys = [0, 1, 2].map((k) =>
    petalDef(o, `camelia-${t}-p${k}`, {
      shape: 'camelia-petal',
      fill: petalGradient(
        o,
        `camelia-${t}-g${k}`,
        mix(p.dark, p.mid, k * 0.25),
        mix(p.mid, p.light, 0.35 + k * 0.15),
        mix(p.light, WHITE, 0.4),
      ),
      edge: p.edge,
      edgeOpacity: 0.42,
      vein: VEIN,
      shine: SHINE,
      shineOpacity: 0.75,
    }),
  );

  const spin = o.rng() * 60;
  let body = petalRing(o, keys[0] as string, 6, spin, 1, 4);
  body += shadeCircle(o, 'camelia', 27, mix(p.edge, '#6e2a40', 0.3), 0.22);
  body += petalRing(o, keys[1] as string, 6, spin + 30, 0.72, 5);
  body += shadeCircle(o, 'camelia', 19, mix(p.edge, '#6e2a40', 0.3), 0.22);
  body += petalRing(o, keys[2] as string, 5, spin + 12, 0.46, 6);

  // Corona de estambres: base crema, filamentos dorados y anteras alrededor.
  o.defs.radial(
    'camelia-crown',
    [
      [0, '#fff6d8'],
      [0.7, '#f6dc8f'],
      [1, '#e7bb57'],
    ],
    45,
    40,
    65,
  );
  body += `<circle r="${o.detail === 'icon' ? 8 : 9}" fill="${o.defs.ref('camelia-crown')}" stroke="#c99a3c" stroke-opacity=".45" stroke-width=".7"/>`;
  const n = o.detail === 'icon' ? 7 : o.detail === 'lite' ? 14 : 22;
  let filaments = '';
  let anthers = '';
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + o.rng() * 0.25;
    const d = (o.detail === 'icon' ? 6 : 7) + o.rng() * 3.2;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    if (o.detail !== 'icon') filaments += `M${f(x * 0.35)} ${f(y * 0.35)}L${f(x)} ${f(y)}`;
    anthers += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(o.detail === 'icon' ? 1.9 : 1.25 + o.rng() * 0.5)}" fill="${i % 3 ? '#e2a93a' : '#f3cd62'}" stroke="#a8742a" stroke-opacity=".35" stroke-width=".4"/>`;
  }
  if (filaments) {
    body += `<path d="${filaments}" stroke="#d9a441" stroke-opacity=".85" stroke-width=".8" stroke-linecap="round"/>`;
  }
  body += anthers;
  return { body, radius: 37, attach: { x: 0, y: 30 }, leaf: 'lance' };
};
