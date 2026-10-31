import {
  WHITE,
  petalDef,
  petalGradient,
  petalRing,
  shadeCircle,
  speckles,
  type HeadDrawer,
  type Palette,
  pastelSet,
} from './common';
import { f, mix } from '../svg';

const PALETTES = pastelSet([
  { dark: '#b84d6c', mid: '#e07f9b', light: '#f8d3dc', edge: '#8f3a55' },
  { dark: '#a8405f', mid: '#d86b89', light: '#f4c0cd', edge: '#822f4b' },
  { dark: '#c9708a', mid: '#eaa2b5', light: '#fde6ec', edge: '#9a4a62' },
]);

/** Pétalo ancho y abombado, con el borde superior algo ondulado (como una rosa abierta). */
const PETAL =
  'M0 0C-15-2-26-13-25-27C-24-36-17-41-9-40C-5-42-2-41 0-39C2-41 5-42 9-40C17-41 24-36 25-27C26-13 15-2 0 0Z';
/** Borde enrollado hacia fuera: una franja clara justo bajo el filo. */
const ROLL = 'M-23-30C-19-37-12-39-8-38C-4-40 4-40 8-38C12-39 19-37 23-30';
/** Sombra del pliegue bajo el borde enrollado. */
const UNDER = 'M-22-27C-14-33 14-33 22-27C14-30-14-30-22-27Z';
/** Pétalo interior: más estrecho y alto, como una copa que envuelve el centro. */
const CUP = 'M0 0C-12-1-19-10-18-21C-17-30-9-34 0-33C9-34 17-30 18-21C19-10 12-1 0 0Z';
const CUP_ROLL = 'M-15-25C-10-31-4-32 0-31C4-32 10-31 15-25';

export const drawRosa: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  const t = o.tone % 3;
  o.defs.shape('rosa-petal', PETAL);
  o.defs.shape('rosa-cup', CUP);
  const deep = mix(p.dark, '#5a1f33', 0.25);

  // Cuatro capas: las de fuera, abiertas y claras; las de dentro, más cerradas y más intensas.
  const layers = [
    { k: 0, shape: 'rosa-petal', roll: ROLL },
    { k: 1, shape: 'rosa-petal', roll: ROLL },
    { k: 2, shape: 'rosa-cup', roll: CUP_ROLL },
    { k: 3, shape: 'rosa-cup', roll: CUP_ROLL },
  ].map(({ k, shape, roll }) => {
    const fill = petalGradient(
      o,
      `rosa-${t}-g${k}`,
      mix(p.dark, deep, 0.1 + k * 0.1),
      mix(p.mid, p.dark, k * 0.12),
      mix(p.light, WHITE, 0.3 - k * 0.08),
    );
    return petalDef(o, `rosa-${t}-p${k}`, {
      shape,
      fill,
      edge: p.edge,
      edgeOpacity: 0.5,
      ...(shape === 'rosa-petal' ? { fold: UNDER } : {}),
      foldColor: p.edge,
      foldOpacity: 0.16,
      shine: roll,
      shineOpacity: 0.55,
    });
  });

  const outer = 5 + (o.rng() > 0.5 ? 1 : 0);
  const spin = o.rng() * 72;
  let body = petalRing(o, layers[0] as string, outer, spin, 1, 5);
  body += shadeCircle(o, 'rosa', 30, deep, 0.36);
  body += petalRing(o, layers[1] as string, 5, spin + 36, 0.78, 5);
  body += shadeCircle(o, 'rosa', 22, deep, 0.4);
  body += petalRing(o, layers[2] as string, 4, spin + 12, 0.74, 5);
  body += petalRing(o, layers[3] as string, 3, spin + 70, 0.52, 6);

  // Corazón en espiral: pétalos en media luna, cada vez más pequeños, enrollados sobre sí mismos.
  o.defs.shape('rosa-curl', 'M-9 3C-11-5-4-11 4-10C9-9 11-5 10-1C7-6 2-7-2-6C-6-5-8-1-9 3Z');
  o.defs.radial(
    `rosa-${t}-heart`,
    [
      [0, mix(deep, p.dark, 0.2)],
      [0.75, mix(p.mid, p.dark, 0.3)],
      [1, p.mid],
    ],
    50,
    50,
    60,
  );
  o.defs.radial(
    `rosa-${t}-curl`,
    [
      [0, mix(p.dark, deep, 0.3)],
      [0.6, mix(p.mid, p.dark, 0.2)],
      [1, mix(p.light, WHITE, 0.2)],
    ],
    50,
    100,
    90,
  );
  body += `<g transform="rotate(${f(spin)})">`;
  body += `<circle r="10.5" fill="${o.defs.ref(`rosa-${t}-heart`)}"/>`;
  const curls = o.detail === 'icon' ? 2 : 4;
  for (let i = 0; i < curls; i++) {
    const k = 1.05 - i * 0.2;
    body += `<use href="${o.defs.use('rosa-curl')}" transform="rotate(${f(i * 105)}) scale(${f(k)})" fill="${o.defs.ref(`rosa-${t}-curl`)}" stroke="${p.edge}" stroke-opacity=".45" stroke-width=".7"/>`;
  }
  if (o.detail !== 'icon') {
    body += `<path d="M2.5 0.5C1.5-1.5-1-1-1 0.8" fill="none" stroke="${deep}" stroke-opacity=".7" stroke-width="1" stroke-linecap="round"/>`;
  }
  body += '</g>';
  body += speckles(o, 22, 34, p.edge);
  return { body, radius: 38, attach: { x: 0, y: 32 }, leaf: 'lance' };
};
