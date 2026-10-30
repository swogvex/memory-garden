import { WHITE, type DrawOptions, type HeadDrawer, type Palette, pastelSet } from './common';
import { f, mix } from '../svg';
import { jitter } from '../rng';

const PALETTES = pastelSet([
  { dark: '#6f4fae', mid: '#9b7fd1', light: '#cdbdf0', edge: '#4f3584' },
  { dark: '#5b5bb0', mid: '#8a8fdc', light: '#c7caf3', edge: '#3f3f86' },
  { dark: '#8a4fa8', mid: '#b88ad6', light: '#e4cdf3', edge: '#65377f' },
]);

const FLORET = 'M0 0C-3.5-2-4.5-8 0-11C4.5-8 3.5-2 0 0Z';

function spike(o: DrawOptions, p: Palette, levels: number, lengthScale: number): string {
  const { rng, defs } = o;
  const top = -48 * lengthScale;
  const step = (46 - top) / levels - 0.4;
  const icon = o.detail === 'icon';
  let out = `<path d="M0 46L0 ${f(top + 6)}" stroke="#6b8a62" stroke-width="${icon ? 3 : 1.6}" stroke-linecap="round"/>`;
  const detailBoost = o.detail === 'icon' ? 0 : 1;
  for (let i = 0; i < levels; i++) {
    const y = top + 8 + i * step;
    // En miniatura los capullos son más gruesos: la espiga tiene que leerse a 20 px.
    const k = (0.78 + (0.55 * i) / levels) * (icon ? 1.45 : 1);
    const key = `lavanda-${o.tone}-${Math.min(3, Math.floor((i / levels) * 4))}`;
    for (const side of [-1, 1]) {
      const a = side * (32 + jitter(rng, 8));
      out += `<use href="${defs.use('lavanda-floret')}" transform="translate(${f(side * (icon ? 2.4 : 1.4))} ${f(y + jitter(rng, 1))}) rotate(${f(a)}) scale(${f(k)})" fill="${defs.ref(key)}" stroke="${p.edge}" stroke-opacity=".35" stroke-width="${f(0.8 / k)}"/>`;
    }
    if (detailBoost && i % 2 === 0) {
      out += `<use href="${defs.use('lavanda-floret')}" transform="translate(0 ${f(y - 2)}) rotate(${f(jitter(rng, 10))}) scale(${f(k * 0.9)})" fill="${defs.ref(key)}" stroke="${p.edge}" stroke-opacity=".35" stroke-width="${f(0.8 / k)}"/>`;
    }
  }
  out += `<use href="${defs.use('lavanda-floret')}" transform="translate(0 ${f(top + 4)}) scale(.6)" fill="${defs.ref(`lavanda-${o.tone}-3`)}"/>`;
  return out;
}

export const drawLavanda: HeadDrawer = (o) => {
  const p = PALETTES[o.tone % 3] as Palette;
  o.defs.shape('lavanda-floret', FLORET);
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    o.defs.radial(`lavanda-${o.tone}-${i}`, [
      [0, mix(p.dark, p.mid, 1 - t * 0.6)],
      [0.55, mix(p.mid, p.light, 0.2 + t * 0.4)],
      [1, mix(p.light, WHITE, 0.2 + t * 0.4)],
    ]);
  }
  const levels = o.detail === 'icon' ? 6 : 10;
  // Tres espigas también en miniatura (antes, una sola: a 20 px era una raya).
  const sides =
    o.detail === 'icon'
      ? `<g transform="translate(-12 10) rotate(-15)">${spike(o, p, 4, 0.7)}</g><g transform="translate(12 10) rotate(15)">${spike(o, p, 4, 0.74)}</g>`
      : `<g transform="translate(-6 8) rotate(-13)">${spike(o, p, levels - 1, 0.82)}</g><g transform="translate(6 8) rotate(13)">${spike(o, p, levels - 1, 0.86)}</g>`;
  const body = `${sides}${spike(o, p, levels, 1)}`;
  return { body, radius: 36, attach: { x: 0, y: 46 }, leaf: 'strap' };
};
