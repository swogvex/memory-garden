import { WHITE, type DrawOptions, type HeadDrawer, type Palette, pastelSet } from './common';
import { f, mix } from '../svg';

const PALETTES = pastelSet([
  { dark: '#e0604f', mid: '#f4955a', light: '#fbd3a8', edge: '#a8402f' },
  { dark: '#d4506a', mid: '#ee8aa0', light: '#fbd2dc', edge: '#9a3148' },
  { dark: '#e6914d', mid: '#f7bf7c', light: '#fde8c4', edge: '#b5703a' },
]);

/** Pétalos de atrás: asoman por arriba entre los de delante, en un tono más oscuro. */
const BACK = 'M-3 26C-15 20-17-8-6-36C-4-39-1-41 1-40C11-20 9 12-3 26Z';
/** Pétalo lateral: abraza la copa y se abre un poco hacia fuera en la punta. */
const SIDE = 'M0 32C-16 30-25 14-25-6C-25-20-21-31-15-38C-13-30-8-20-3-12C0 0 1 18 0 32Z';
/** Pétalo delantero: el más grande, con la punta algo levantada. */
const FRONT = 'M0 34C-16 32-21 10-17-12C-14-26-6-36 0-40C6-36 14-26 17-12C21 10 16 32 0 34Z';

function vertical(o: DrawOptions, key: string, top: string, bottom: string): string {
  o.defs.linear(
    key,
    [
      [0, top],
      [0.55, mix(top, bottom, 0.45)],
      [1, bottom],
    ],
    30,
    0,
    70,
    100,
  );
  return o.defs.ref(key);
}

export const drawTulipan: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  const t = o.tone % 3;
  const d = o.defs;
  d.shape('tulipan-back', BACK);
  d.shape('tulipan-side', SIDE);
  d.shape('tulipan-front', FRONT);
  const stroke = `stroke="${p.edge}" stroke-opacity=".45" stroke-width="1" stroke-linejoin="round"`;
  const back = vertical(o, `tulipan-${t}-b`, p.mid, mix(p.dark, '#5a1f20', 0.15));
  const side = vertical(o, `tulipan-${t}-s`, mix(p.light, p.mid, 0.3), p.dark);
  const front = vertical(o, `tulipan-${t}-f`, mix(p.light, WHITE, 0.25), mix(p.mid, p.dark, 0.45));
  const lean = (o.rng() - 0.5) * 8;
  let body = `<g transform="rotate(${f(lean)})">`;
  body += `<use href="${d.use('tulipan-back')}" fill="${back}" ${stroke}/>`;
  body += `<use href="${d.use('tulipan-back')}" transform="scale(-1 1)" fill="${back}" ${stroke}/>`;
  body += `<use href="${d.use('tulipan-side')}" fill="${side}" ${stroke}/>`;
  body += `<use href="${d.use('tulipan-side')}" transform="scale(-1 1)" fill="${side}" ${stroke}/>`;
  body += `<use href="${d.use('tulipan-front')}" fill="${front}" ${stroke}/>`;
  if (o.detail !== 'icon') {
    // Surcos del pétalo delantero, sombra del borde de los laterales y brillo vertical.
    body += `<path d="M0 30C-1 6-1-16 0-35M-7 27C-10 6-9-14-4-30M7 27C10 6 9-14 4-30" fill="none" stroke="${p.edge}" stroke-opacity=".16" stroke-width=".8" stroke-linecap="round"/>`;
    body += `<path d="M-15 24C-19 12-19-2-16-12M15 24C19 12 19-2 16-12" fill="none" stroke="${p.edge}" stroke-opacity=".22" stroke-width="1.6" stroke-linecap="round"/>`;
    body += `<path d="M-9-10C-7-20-4-28 0-33" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>`;
    body += `<path d="M-21 2C-22-10-20-20-16-28" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.5" stroke-linecap="round"/>`;
  }
  body += '</g>';
  return { body, radius: 36, attach: { x: 0, y: 30 }, leaf: 'strap' };
};
