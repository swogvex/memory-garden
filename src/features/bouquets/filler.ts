import { Defs, f, jitter, makeRng, mix, type Detail, type Rng } from '@/lib/flowers';
import type { PlacedFiller } from './model';

/**
 * Relleno decorativo del ramo (decisión C de H7.5): espigas lilas, florecillas blancas, ramas
 * verdes y capullos del mes vacío. No es un recuerdo: no es interactivo y va dentro de un grupo
 * `aria-hidden`. Se dibuja más pequeño y más pálido que las flores de los recuerdos, para que la
 * espiga lila no se confunda con la lavanda ni las florecillas con la margarita.
 */

const SPRIG = [
  ['#a891cf', '#cbbbe8', '#efe8f8'],
  ['#9d9fd6', '#c6c8ee', '#ebebfa'],
  ['#b596c8', '#d7c2e5', '#f3e9f7'],
] as const;
const GREEN = [
  ['#86a07e', '#a9bd9f', '#d4e0cc'],
  ['#7d9a86', '#a2baa9', '#d0dfd4'],
  ['#8fa27a', '#b0c09c', '#d9e2c9'],
] as const;
const FILLER_STEM = '#7f9576';

function sprigGradient(defs: Defs, tone: number): string {
  const c = SPRIG[tone % 3] as readonly [string, string, string];
  defs.radial(`sprig-${tone % 3}`, [
    [0, c[0]],
    [0.6, c[1]],
    [1, c[2]],
  ]);
  return defs.ref(`sprig-${tone % 3}`);
}

function greenGradient(defs: Defs, tone: number): string {
  const c = GREEN[tone % 3] as readonly [string, string, string];
  defs.radial(`green-${tone % 3}`, [
    [0, c[0]],
    [0.6, c[1]],
    [1, c[2]],
  ]);
  return defs.ref(`green-${tone % 3}`);
}

/** Espiga lila fina: capullos alternos en el último 55 % del tallo. */
function sprig(defs: Defs, detail: Detail, length: number, tone: number, rng: Rng): string {
  defs.shape('sprig-bud', 'M0 0C-2.8-1.8-3.4-6.4 0-9C3.4-6.4 2.8-1.8 0 0Z');
  const fill = sprigGradient(defs, tone);
  const n = detail === 'full' ? 12 : 9;
  let buds = '';
  for (let i = 0; i < n; i++) {
    const t = 0.4 + (0.6 * i) / (n - 1);
    const y = -length * t;
    const side = i % 2 ? 1 : -1;
    const k = 1.5 - 0.75 * (i / (n - 1));
    const a = side * (30 + jitter(rng, 8));
    buds += `<use href="${defs.use('sprig-bud')}" transform="translate(${f(side * 1.2)} ${f(y)}) rotate(${f(a)}) scale(${f(k)})"/>`;
  }
  buds += `<use href="${defs.use('sprig-bud')}" transform="translate(0 ${f(-length - 2)}) scale(.55)"/>`;
  const edge = mix(SPRIG[tone % 3]![0], '#4f3584', 0.4);
  // Relleno y contorno en el grupo (no en cada capullo): mismo dibujo con menos bytes.
  const out =
    `<path d="M0 0L0 ${f(-length)}" stroke="${FILLER_STEM}" stroke-width="1.4" stroke-linecap="round"/>` +
    `<g fill="${fill}" stroke="${edge}" stroke-opacity=".3" stroke-width=".5">${buds}</g>`;
  return out;
}

/** Florecillas blancas (tipo paniculata): ramitas finas con flores diminutas. */
function gyps(defs: Defs, detail: Detail, length: number, rng: Rng): string {
  let petals = '';
  for (let i = 0; i < 5; i++) {
    const a = (i * 72 * Math.PI) / 180;
    petals += `<circle cx="${f(Math.sin(a) * 2)}" cy="${f(-Math.cos(a) * 2)}" r="1.7"/>`;
  }
  defs.group(
    'gyps-fl',
    `<g fill="#fffdf8" stroke="#a9a0b8" stroke-opacity=".55" stroke-width=".4">${petals}</g><circle r=".9" fill="#e8d9a6"/>`,
  );
  const branches = 4;
  let lines = '';
  let flowers = '';
  for (let b = 0; b < branches; b++) {
    const a = ((-44 + (88 * b) / (branches - 1) + jitter(rng, 6)) * Math.PI) / 180;
    const len = length * (0.6 + rng() * 0.4);
    const ex = Math.sin(a) * len;
    const ey = -length * 0.35 - Math.cos(a) * len * 0.75;
    const mx = Math.sin(a) * len * 0.3;
    const my = -length * 0.45;
    lines += `<path d="M0 0Q${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}" fill="none" stroke="${FILLER_STEM}" stroke-width=".8" stroke-linecap="round"/>`;
    const per = detail === 'full' ? 3 : 2;
    for (let i = 0; i < per; i++) {
      const fx = ex + jitter(rng, 5);
      const fy = ey + jitter(rng, 4) - i * 2;
      flowers += `<use href="${defs.use('gyps-fl')}" transform="translate(${f(fx)} ${f(fy)}) scale(${f(1 + rng() * 0.35)})"/>`;
    }
  }
  return lines + flowers;
}

/** Rama verde: hojas por pares pegadas a su tallo y una hoja en la punta. */
function greens(defs: Defs, length: number, tone: number, rng: Rng): string {
  defs.shape('green-leaf', 'M0 0C-5.5-4-6.5-14 0-21C6.5-14 5.5-4 0 0Z');
  const fill = greenGradient(defs, tone);
  const bend = jitter(rng, 8);
  let out = `<path d="M0 0Q${f(bend)} ${f(-length * 0.5)} 0 ${f(-length)}" fill="none" stroke="${FILLER_STEM}" stroke-width="1.3" stroke-linecap="round"/>`;
  const pairs = 4;
  let leaves = '';
  for (let i = 0; i < pairs; i++) {
    const t = 0.22 + (0.72 * i) / pairs;
    // Punto de la curva cuadrática (0,0)→(bend, −L/2)→(0, −L) en t: la hoja nace sobre el tallo.
    const x = 2 * (1 - t) * t * bend;
    const y = -length * t;
    const k = 1.05 - 0.45 * (i / pairs);
    for (const side of [-1, 1] as const) {
      const a = side * (52 + jitter(rng, 10));
      leaves += `<use href="${defs.use('green-leaf')}" transform="translate(${f(x)} ${f(y)}) rotate(${f(a)}) scale(${f(k)})"/>`;
    }
  }
  leaves += `<use href="${defs.use('green-leaf')}" transform="translate(0 ${f(-length)}) scale(.7)"/>`;
  out += `<g fill="${fill}" stroke="#4f6a4a" stroke-opacity=".28" stroke-width=".6">${leaves}</g>`;
  return out;
}

/** Capullo cerrado (mes vacío): pétalos plegados y sépalos verdes. */
function bud(defs: Defs, length: number, tone: number): string {
  const tops = ['#e8c8d1', '#dcd0f0', '#f1dcc8'] as const;
  defs.radial(
    `bud-${tone % 3}`,
    [
      [0, '#b7c7a9'],
      [0.45, mix(tops[tone % 3] as string, '#b7c7a9', 0.25)],
      [1, tops[tone % 3] as string],
    ],
    50,
    100,
    110,
  );
  const k = length / 30;
  return (
    `<g transform="scale(${f(k)})">` +
    `<path d="M0 0C-8-4-9-19 0-30C9-19 8-4 0 0Z" fill="${defs.ref(`bud-${tone % 3}`)}" stroke="#8a7a98" stroke-opacity=".35" stroke-width=".7"/>` +
    `<path d="M0-1C-2-10-1-20 1-28" fill="none" stroke="#8a7a98" stroke-opacity=".3" stroke-width=".6"/>` +
    `<path d="M0 1C-6-1-9-7-8-13C-5-8-2-5 0-3ZM0 1C6-1 9-7 8-13C5-8 2-5 0-3Z" fill="#8fa685" stroke="#4f6a4a" stroke-opacity=".3" stroke-width=".5"/>` +
    `</g>`
  );
}

/** Un adorno de relleno colocado en el lienzo (sin su tallo, que se dibuja con los demás). */
export function renderFiller(defs: Defs, detail: Detail, item: PlacedFiller): string {
  const rng = makeRng(item.seed);
  let inner: string;
  if (item.kind === 'sprig') inner = sprig(defs, detail, item.length, item.tone, rng);
  else if (item.kind === 'gyps') inner = gyps(defs, detail, item.length, rng);
  else if (item.kind === 'greens') inner = greens(defs, item.length, item.tone, rng);
  else inner = bud(defs, item.length, item.tone);
  return `<g transform="translate(${f(item.x)} ${f(item.y)}) rotate(${f(item.rot)})">${inner}</g>`;
}
