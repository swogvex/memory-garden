import { WHITE, soft, type DrawOptions, type HeadDrawer } from './common';
import { f, mix } from '../svg';
import { jitter } from '../rng';

/** Cuatro colores por tono: la mezcla de azules, rosas y lilas de una hortensia real. */
const COLORS: readonly (readonly string[])[] = [
  ['#8fb0e3', '#a9bdf0', '#b8a6dd', '#c9d7f6'],
  ['#e795b4', '#f2b6cb', '#d8a6d6', '#f7d3e2'],
  ['#b8a0d9', '#cbb8ec', '#a3b4ea', '#e2d5f6'],
];

/** Pétalo redondeado de una florecilla (cuatro forman una flor de cruz). */
const PETAL =
  'M0 0C-3.6-0.6-6.4-4-5.6-7.6C-5-10.6-2.4-12 0-11.4C2.4-12 5-10.6 5.6-7.6C6.4-4 3.6-0.6 0 0Z';

function floret(o: DrawOptions, variant: number): string {
  const color = soft((COLORS[o.tone % 3] as readonly string[])[variant] as string, 0.15);
  const key = `hortensia-${o.tone % 3}-${variant}`;
  o.defs.radial(`${key}-g`, [
    [0, mix(color, '#3b3f7a', 0.3)],
    [0.45, color],
    [1, mix(color, WHITE, 0.6)],
  ]);
  const edge = mix(color, '#2f3470', 0.5);
  let inner = '';
  for (let i = 0; i < 4; i++) {
    inner += `<use href="${o.defs.use('hortensia-petal')}" transform="rotate(${i * 90 + 45})" fill="${o.defs.ref(`${key}-g`)}" stroke="${edge}" stroke-opacity=".42" stroke-width=".6"/>`;
  }
  inner += `<circle r="1.5" fill="${mix(color, '#2f3470', 0.35)}"/><circle r=".7" fill="#fffbe8"/>`;
  o.defs.group(key, inner);
  return key;
}

export const drawHortensia: HeadDrawer = (o) => {
  o.defs.shape('hortensia-petal', PETAL);
  const t = o.tone % 3;
  const keys = [0, 1, 2, 3].map((v) => floret(o, v));
  // Cúpula: más clara arriba a la izquierda y en sombra abajo; da volumen a la bola.
  const dome = soft((['#a9b6ea', '#e3a9c4', '#c2b0e6'] as const)[t] as string, 0.15);
  o.defs.radial(
    `hortensia-dome-${t}`,
    [
      [0, mix(dome, WHITE, 0.25)],
      [0.6, dome],
      [1, mix(dome, '#4b5598', 0.5)],
    ],
    38,
    32,
    72,
  );
  let body = `<circle r="35" fill="${o.defs.ref(`hortensia-dome-${t}`)}"/>`;
  const N = o.detail === 'icon' ? 14 : o.detail === 'lite' ? 40 : 58;
  const R = 33.5;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const spin = o.rng() * Math.PI * 2;
  const items: { x: number; y: number; k: number; a: number; v: string; d: number }[] = [];
  for (let i = 0; i < N; i++) {
    const d = R * Math.sqrt((i + 0.5) / N);
    const a = spin + i * GOLDEN;
    // Las del borde, algo menores (la bola se curva); en miniatura, más grandes para leerse.
    const k =
      (0.92 - 0.24 * (d / R)) * (o.detail === 'icon' ? 1.85 : o.detail === 'lite' ? 1.12 : 1);
    items.push({
      x: Math.cos(a) * d + jitter(o.rng, 0.6),
      y: Math.sin(a) * d + jitter(o.rng, 0.6),
      k,
      a: o.rng() * 90,
      v: keys[Math.floor(o.rng() * 4)] as string,
      d,
    });
  }
  // De fuera hacia dentro: las del centro quedan delante, como en una cúpula.
  items.sort((a, b) => b.d - a.d);
  for (const it of items) {
    body += `<use href="${o.defs.use(it.v)}" transform="translate(${f(it.x)} ${f(it.y)}) rotate(${f(it.a)}) scale(${f(it.k)})"/>`;
  }
  if (o.detail !== 'icon') {
    o.defs.radial(
      'hortensia-shade',
      [
        [0.55, '#2f3470', 0],
        [1, '#2f3470', 0.22],
      ],
      58,
      62,
      55,
    );
    body += `<circle r="37" fill="${o.defs.ref('hortensia-shade')}"/>`;
    body += `<ellipse cx="-12" cy="-15" rx="13" ry="7.5" transform="rotate(-32 -12 -15)" fill="#fff" fill-opacity=".16"/>`;
  }
  return { body, radius: 40, attach: { x: 0, y: 36 }, leaf: 'broad' };
};
