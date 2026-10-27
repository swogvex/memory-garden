import { WHITE, type DrawOptions, type HeadDrawer } from './common';
import { f, mix } from '../svg';
import { jitter } from '../rng';

const COLORS: readonly (readonly string[])[] = [
  ['#8fb0e3', '#a6b8ee', '#b8a0d9', '#c4d3f5'],
  ['#e58fb0', '#f0b0c8', '#d9a0d0', '#f6cfe0'],
  ['#b8a0d9', '#cbb5ea', '#9fb0e8', '#e0d2f5'],
];

const PETAL = 'M0 0C-5.5-1-7-9 0-12C7-9 5.5-1 0 0Z';

function floretGroup(o: DrawOptions, variant: number): string {
  const color = (COLORS[o.tone % 3] as readonly string[])[variant] as string;
  const key = `hortensia-${o.tone}-${variant}`;
  o.defs.radial(`${key}-g`, [
    [0, mix(color, '#3b3f7a', 0.35)],
    [0.6, color],
    [1, mix(color, WHITE, 0.55)],
  ]);
  let inner = '';
  for (let i = 0; i < 4; i++) {
    inner += `<use href="${o.defs.use('hortensia-petal')}" transform="rotate(${i * 90 + 12})" fill="${o.defs.ref(`${key}-g`)}" stroke="${mix(color, '#2f3470', 0.5)}" stroke-opacity=".35" stroke-width=".5"/>`;
  }
  inner += `<circle r="1.5" fill="#fbf3d0" fill-opacity=".9"/>`;
  o.defs.group(key, inner);
  return key;
}

export const drawHortensia: HeadDrawer = (o) => {
  o.defs.shape('hortensia-petal', PETAL);
  const keys = [0, 1, 2, 3].map((v) => floretGroup(o, v));
  const dome = (['#a9b6ea', '#e3a9c4', '#c2b0e6'] as const)[o.tone % 3] as string;
  o.defs.radial(
    `hortensia-dome-${o.tone}`,
    [
      [0, dome],
      [1, mix(dome, '#5a67ad', 0.45)],
    ],
    45,
    40,
    62,
  );
  let body = `<circle r="34" fill="${o.defs.ref(`hortensia-dome-${o.tone}`)}"/>`;
  const N = o.detail === 'icon' ? 14 : o.detail === 'lite' ? 24 : 32;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const items: { x: number; y: number; k: number; a: number; v: string }[] = [];
  for (let i = 0; i < N; i++) {
    const d = 33 * Math.sqrt((i + 0.5) / N);
    const a = i * GOLDEN;
    const k = (1.5 - 0.35 * (d / 33)) * (o.detail === 'icon' ? 1.5 : 1.1);
    items.push({
      x: Math.cos(a) * d * 1.04 + jitter(o.rng, 0.8),
      y: Math.sin(a) * d * 1.04 + jitter(o.rng, 0.8),
      k,
      a: o.rng() * 90,
      v: keys[Math.floor(o.rng() * 4)] as string,
    });
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i] as (typeof items)[number];
    body += `<use href="${o.defs.use(it.v)}" transform="translate(${f(it.x)} ${f(it.y)}) rotate(${f(it.a)}) scale(${f(it.k)})"/>`;
  }
  if (o.detail !== 'icon') {
    body += `<ellipse cx="-12" cy="-16" rx="12" ry="7" transform="rotate(-30 -12 -16)" fill="#fff" fill-opacity=".18"/>`;
  }
  return { body, radius: 40, attach: { x: 0, y: 36 }, leaf: 'broad' };
};
