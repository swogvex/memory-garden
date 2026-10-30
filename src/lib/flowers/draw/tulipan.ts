import { WHITE, type DrawOptions, type HeadDrawer, type Palette, pastelSet } from './common';
import { mix } from '../svg';

const PALETTES = pastelSet([
  { dark: '#e0604f', mid: '#f4955a', light: '#fbd0a2', edge: '#a8402f' },
  { dark: '#c9442f', mid: '#e8704a', light: '#f8b78f', edge: '#8f2f21' },
  { dark: '#e6914d', mid: '#f7bf7c', light: '#fde6bf', edge: '#b5703a' },
]);

const BACK = 'M0 28C-12 24-14-12 0-38C14-12 12 24 0 28Z';
const SIDE = 'M-2 33C-27 31-34 6-29-16C-27-26-22-33-17-36C-14-24-9-12-5-2C-4 10-3 22-2 33Z';
const FRONT = 'M0 35C-18 32-23-6-10-28C-6-35-2-39 0-40C2-39 6-35 10-28C23-6 18 32 0 35Z';

function grad(o: DrawOptions, p: Palette, name: string, k: number): string {
  const key = `tulipan-${o.tone}-${name}`;
  o.defs.radial(key, [
    [0, mix(p.dark, p.mid, k)],
    [0.55, mix(p.mid, p.light, k)],
    [1, mix(p.light, WHITE, k)],
  ]);
  return o.defs.ref(key);
}

export const drawTulipan: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  o.defs.shape('tulipan-back', BACK);
  o.defs.shape('tulipan-side', SIDE);
  o.defs.shape('tulipan-front', FRONT);
  const d = o.defs;
  const stroke = `stroke="${p.edge}" stroke-opacity=".5" stroke-width="1.2"`;
  const lean = (o.rng() - 0.5) * 6;
  let body = `<g transform="rotate(${lean.toFixed(1)})">`;
  body += `<use href="${d.use('tulipan-back')}" fill="${grad(o, p, 'back', 0)}" ${stroke}/>`;
  body += `<use href="${d.use('tulipan-side')}" fill="${grad(o, p, 'side', 0.12)}" ${stroke}/>`;
  body += `<use href="${d.use('tulipan-side')}" transform="scale(-1 1)" fill="${grad(o, p, 'side', 0.12)}" ${stroke}/>`;
  body += `<use href="${d.use('tulipan-front')}" fill="${grad(o, p, 'front', 0.28)}" ${stroke}/>`;
  if (o.detail !== 'icon') {
    body += `<path d="M0 26C-1-4-1-20 0-31M-8 22C-12 0-8-16-3-27M8 22C12 0 8-16 3-27" fill="none" stroke="${p.edge}" stroke-opacity=".2" stroke-width=".8" stroke-linecap="round"/>`;
    body += `<path d="M-9-14C-6-22-3-28 0-32" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.8" stroke-linecap="round"/>`;
    body += `<path d="M-21 6C-22-6-21-16-17-24" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.4" stroke-linecap="round"/>`;
  }
  body += '</g>';
  return { body, radius: 36, attach: { x: 0, y: 30 }, leaf: 'strap' };
};
