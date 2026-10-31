import { WHITE, type DrawOptions, type HeadDrawer, type Palette, pastelSet } from './common';
import { f, mix } from '../svg';
import { jitter } from '../rng';

const PALETTES = pastelSet([
  { dark: '#6f4fae', mid: '#9b7fd1', light: '#d4c4f2', edge: '#4f3584' },
  { dark: '#5b5bb0', mid: '#8a8fdc', light: '#cbcef5', edge: '#3f3f86' },
  { dark: '#8a4fa8', mid: '#b88ad6', light: '#e7d2f5', edge: '#65377f' },
]);

/** Florecilla de lavanda: un tubito redondeado, más ancho arriba. */
const BUD =
  'M0 0C-1.9-0.6-2.6-3.6-2.4-6.4C-2.2-8.6-1.1-9.6 0-9.5C1.1-9.6 2.2-8.6 2.4-6.4C2.6-3.6 1.9-0.6 0 0Z';
/** Cáliz gris verdoso bajo cada verticilo. */
const CALYX = 'M-3.2 0.6C-1.8 2.2 1.8 2.2 3.2 0.6C1.6 1.4-1.6 1.4-3.2 0.6Z';

/**
 * Una espiga: verticilos (anillos de florecillas) separados abajo y cada vez más juntos y
 * pequeños hacia la punta, como la lavanda de verdad. `len` = largo de la espiga en unidades.
 */
/** Verticilo completo (dos florecillas detrás, tres delante y el cáliz) definido una vez por color. */
function whorlDef(o: DrawOptions, p: Palette, shade: number): string {
  const t = o.tone % 3;
  const key = `lavanda-${t}-w${shade}`;
  const bud = o.defs.use('lavanda-bud');
  const stroke = `stroke="${p.edge}" stroke-opacity=".3" stroke-width=".55"`;
  let inner = '';
  if (o.detail !== 'icon') {
    inner += `<g fill="${o.defs.ref(`lavanda-${t}-back`)}" ${stroke}><use href="${bud}" transform="rotate(-62) scale(.9)"/><use href="${bud}" transform="rotate(62) scale(.9)"/></g>`;
  }
  const front = o.detail === 'icon' ? [-30, 30] : [-34, 0, 34];
  inner += `<g fill="${o.defs.ref(`lavanda-${t}-${shade}`)}" ${stroke}>${front.map((a) => `<use href="${bud}" transform="translate(0 1) rotate(${a})"/>`).join('')}</g>`;
  if (o.detail !== 'icon' && shade < 3) {
    inner += `<use href="${o.defs.use('lavanda-calyx')}" transform="translate(0 1.2)" fill="#8c9a86" fill-opacity=".8"/>`;
  }
  o.defs.group(key, inner);
  return key;
}

/**
 * Una espiga: verticilos separados abajo y cada vez más juntos y pequeños hacia la punta,
 * como la lavanda de verdad. `len` = largo de la espiga en unidades.
 */
function spike(o: DrawOptions, p: Palette, whorls: number, len: number): string {
  const { rng, defs } = o;
  const icon = o.detail === 'icon';
  const top = 46 - len;
  let out = `<path d="M0 46L0 ${f(top + 4)}" stroke="#7d9a6e" stroke-width="${icon ? 2.6 : 1.5}" stroke-linecap="round"/>`;
  for (let i = 0; i < whorls; i++) {
    const u = i / (whorls - 1); // 0 = abajo, 1 = punta
    const y = 36 - (len - 14) * (1 - Math.pow(1 - u, 2.1));
    const k = (0.92 - u * 0.3) * (icon ? 1.45 : 1);
    const key = whorlDef(o, p, Math.min(3, Math.floor(u * 4)));
    out += `<use href="${defs.use(key)}" transform="translate(${f(jitter(rng, 0.4))} ${f(y)}) rotate(${f(jitter(rng, 8))}) scale(${f(k)})"/>`;
  }
  out += `<use href="${defs.use('lavanda-bud')}" transform="translate(0 ${f(top + 6)}) scale(${icon ? 0.9 : 0.62})" fill="${defs.ref(`lavanda-${o.tone % 3}-3`)}"/>`;
  return out;
}

export const drawLavanda: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  const t = o.tone % 3;
  o.defs.shape('lavanda-bud', BUD);
  o.defs.shape('lavanda-calyx', CALYX);
  for (let i = 0; i < 4; i++) {
    const u = i / 3;
    o.defs.radial(`lavanda-${t}-${i}`, [
      [0, mix(p.dark, p.mid, u * 0.5)],
      [0.6, mix(p.mid, p.light, 0.15 + u * 0.4)],
      [1, mix(p.light, WHITE, 0.25 + u * 0.35)],
    ]);
  }
  o.defs.radial(`lavanda-${t}-back`, [
    [0, mix(p.dark, '#2e1f55', 0.2)],
    [1, p.mid],
  ]);
  const icon = o.detail === 'icon';
  const whorls = icon ? 5 : o.detail === 'lite' ? 9 : 11;
  // Tres espigas, la del centro más alta (en miniatura también: una sola se ve como una raya).
  const sides = icon
    ? `<g transform="translate(-11 10) rotate(-16)">${spike(o, p, whorls - 1, 64)}</g><g transform="translate(11 10) rotate(16)">${spike(o, p, whorls - 1, 66)}</g>`
    : `<g transform="translate(-6 8) rotate(-13)">${spike(o, p, whorls - 2, 72)}</g><g transform="translate(6 8) rotate(13)">${spike(o, p, whorls - 1, 78)}</g>`;
  const body = `${sides}${spike(o, p, whorls, icon ? 84 : 92)}`;
  return { body, radius: 36, attach: { x: 0, y: 46 }, leaf: 'strap' };
};
