import { FLOWER_INFO, between, fnv1a, jitter, mulberry32 } from '@/lib/flowers';
import type {
  BouquetInput,
  BouquetLayout,
  BouquetMemory,
  FillerKind,
  PlacedFiller,
  PlacedFlower,
  PlacedLeaf,
  PlacedPolaroid,
  StemCurve,
} from './model';
import { headingDeg, stemPoint, stemTangent } from './stem-geometry';

export const CANVAS_WIDTH = 600;
/** Alto fijo del lienzo: las Polaroids van entre las flores, ya no cuelgan debajo. */
export const CANVAS_HEIGHT = 700;
export const MAX_FLOWERS = 21;
export const MAX_POLAROIDS = 5;

/** Centro del lazo: todos los tallos pasan por aquí. */
const BOW = { x: 300, y: 530 } as const;
/** Altura media del corte de los tallos, bajo el lazo. */
const STEM_END = 650;
const RX_MAX = 205;
const ASPECT = 1.2;
const COVERAGE = 1.3;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const RANK = { focal: 0, mid: 1, spike: 2 } as const;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const round1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const hex = (n: number) => n.toString(16).padStart(8, '0');
const rad = (deg: number) => (deg * Math.PI) / 180;
type Rng = () => number;

interface Dome {
  x: number;
  y: number;
  rx: number;
  ry: number;
  r: number;
}

/**
 * Compone el ramo de un mes. Es una función pura y determinista: la misma entrada da siempre
 * el mismo resultado, sin azar real, sin reloj y sin depender del orden de la lista.
 * Algoritmo: copa en abanico sobre el lazo, tallos que convergen en él, hojas sobre los
 * tallos, relleno decorativo alrededor de la copa y Polaroids prendidas en el borde.
 */
export function composeBouquet(input: BouquetInput): BouquetLayout {
  if (!MONTH.test(input.month)) throw new RangeError('bouquet:invalid-month');
  const sorted = [...input.memories].sort((a, b) => cmp(a.date, b.date) || cmp(a.id, b.id));
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i] as BouquetMemory).id === (sorted[i - 1] as BouquetMemory).id) {
      throw new Error('bouquet:duplicate-id');
    }
  }

  // 1. Semilla: mes + ids ordenados. Cada paso toma su propio generador a partir de ella.
  const ids = sorted.map((m) => m.id).sort(cmp);
  const seedKey = `${input.month}|${ids.join(',')}`;
  const seed = fnv1a(seedKey);
  const sub = (label: string) => mulberry32(fnv1a(`${seedKey}|${label}`));

  // 2. Qué recuerdos son flor: todos hasta MAX_FLOWERS; con más, una muestra repartida en el mes.
  const total = sorted.length;
  const visible = pickVisible(sorted);
  const m = visible.length;
  const dome = domeFor(m);

  const flowers = placeFlowers(input.month, visible, dome, sub);
  const filler = placeFiller(input.month, flowers, dome, m, sub('filler'));
  const leaves = placeLeaves(flowers, filler, m, sub('leaves'));
  const polaroids = placePolaroids(sorted, flowers, dome, sub('polaroids'));

  return {
    month: input.month,
    seed: hex(seed),
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    total,
    flowers,
    filler,
    leaves,
    base: BOW,
    bowScale: m <= 3 ? 1 : round1((1 + 0.28 * Math.min(1, dome.rx / RX_MAX)) * 100) / 100,
    dome: { x: round1(dome.x), y: round1(dome.y), rx: round1(dome.rx), ry: round1(dome.ry) },
    polaroids,
    overflow: total > m ? { count: total - m, x: BOW.x - 132, y: BOW.y + 50 } : null,
  };
}

function pickVisible(sorted: readonly BouquetMemory[]): readonly BouquetMemory[] {
  const n = sorted.length;
  if (n <= MAX_FLOWERS) return sorted;
  const out: BouquetMemory[] = [];
  for (let k = 0; k < MAX_FLOWERS; k++) {
    out.push(sorted[Math.round((k * (n - 1)) / (MAX_FLOWERS - 1))] as BouquetMemory);
  }
  return out;
}

/** Radio base de una cabeza según cuántas hay: pocas flores, más grandes. */
function baseRadius(m: number): number {
  if (m >= 6) return Math.max(43, 52 - (m - 6) * 0.6);
  return [0, 84, 70, 62, 57, 54][m] as number;
}

/** Copa del ramo: una elipse más ancha que alta, apoyada sobre el lazo. */
function domeFor(m: number): Dome {
  const r = baseRadius(Math.max(1, m));
  const area = (Math.max(1, m) * Math.PI * r * r) / COVERAGE;
  const rx = m <= 1 ? 0 : Math.min(RX_MAX, Math.sqrt((area * ASPECT) / Math.PI));
  const ry = rx / ASPECT;
  const y = Math.min(330, BOW.y - 120 - ry * 0.9);
  return { x: BOW.x, y, rx, ry, r };
}

/** Tallo de un elemento con su cabeza en (x, y), girada `rot` grados. */
function stemFor(x: number, y: number, rot: number, width: number, rng: Rng): StemCurve {
  const th = rad(rot);
  const downX = -Math.sin(th);
  const downY = Math.cos(th);
  const x1 = BOW.x + clamp((x - BOW.x) * 0.07, -13, 13);
  const len = Math.hypot(x1 - x, BOW.y - y);
  return {
    x0: round1(x),
    y0: round1(y),
    c1x: round1(x + downX * len * 0.35),
    c1y: round1(y + downY * len * 0.35),
    c2x: round1(x1 + (x - x1) * 0.1),
    c2y: round1(BOW.y - len * 0.3),
    x1: round1(x1),
    y1: BOW.y,
    ex: round1(x1 + (x1 - BOW.x) * 2.6 + jitter(rng, 4)),
    ey: round1(STEM_END + jitter(rng, 9)),
    width: round1(width),
    tone: Math.floor(rng() * 3),
  };
}

/** Giro de un elemento según su posición respecto al lazo: lo de los lados se abre hacia fuera. */
const leanFromBow = (x: number, y: number) => headingDeg({ x: x - BOW.x, y: y - BOW.y });

interface Slot {
  x: number;
  y: number;
  d: number;
}

function placeFlowers(
  month: string,
  visible: readonly BouquetMemory[],
  dome: Dome,
  sub: (label: string) => Rng,
): PlacedFlower[] {
  const m = visible.length;
  if (m === 0) return [];
  const rBase = dome.r;

  // 3. Posiciones: espiral de Vogel dentro de la copa. Las primeras quedan en el centro.
  const phase = sub('phase')() * Math.PI * 2;
  const slots: Slot[] = [];
  for (let i = 0; i < m; i++) {
    const d = m === 1 ? 0 : Math.sqrt((i + 0.5) / m);
    const a = phase + i * GOLDEN_ANGLE;
    slots.push({ x: dome.x + dome.rx * d * Math.cos(a), y: dome.y + dome.ry * d * Math.sin(a), d });
  }

  // 4. Reparto: las grandes al centro, las medianas después y las espigas en el borde.
  const shuffle = sub('order');
  const order = visible
    .map((mem) => ({ mem, key: shuffle() }))
    .sort(
      (a, b) =>
        RANK[FLOWER_INFO[a.mem.flower].role] - RANK[FLOWER_INFO[b.mem.flower].role] ||
        a.key - b.key ||
        cmp(a.mem.id, b.mem.id),
    );

  interface Work {
    mem: BouquetMemory;
    x: number;
    y: number;
    r: number;
    hit: number;
    spike: boolean;
  }
  // Las espigas se quedan los huecos exteriores más altos; el resto, del centro hacia fuera.
  const spikes = order.filter(({ mem }) => FLOWER_INFO[mem.flower].role === 'spike').length;
  const byDepth = slots.map((s, i) => ({ s, i })).sort((a, b) => a.s.d - b.s.d || a.i - b.i);
  const outer = byDepth.slice(Math.floor(m / 2));
  const reserved = new Set(
    [...outer]
      .sort((a, b) => a.s.y - b.s.y || a.i - b.i)
      .slice(0, spikes)
      .map((e) => e.i),
  );
  const spikeSlots = byDepth.filter((e) => reserved.has(e.i)).map((e) => e.s);
  const otherSlots = byDepth.filter((e) => !reserved.has(e.i)).map((e) => e.s);
  let si = 0;
  let oi = 0;
  const work: Work[] = order.map(({ mem }) => {
    const isSpike = FLOWER_INFO[mem.flower].role === 'spike';
    const slot = (
      isSpike && si < spikeSlots.length ? spikeSlots[si++] : (otherSlots[oi++] ?? spikeSlots[si++])
    ) as Slot;
    const info = FLOWER_INFO[mem.flower];
    const spike = info.role === 'spike';
    const r = rBase * info.size * (1 - 0.14 * slot.d);
    let { x, y } = slot;
    // Alturas variadas: las espigas sobresalen siempre y algunas medianas, a veces; se alejan del
    // lazo en la dirección de su tallo.
    const lift = spike ? 0.75 : info.role === 'mid' && slot.d > 0.5 && shuffle() < 0.5 ? 0.35 : 0;
    if (lift > 0 && m > 1) {
      const dx = x - BOW.x;
      const dy = y - BOW.y;
      const len = Math.hypot(dx, dy) || 1;
      x += (dx / len) * r * lift;
      y += (dy / len) * r * lift;
    }
    return { mem, x, y, r, hit: spike ? r * 0.55 : r, spike };
  });

  // 5. Equilibrio: separar solapes excesivos, mantener dentro de la copa y centrar la masa.
  if (m > 1) {
    for (let iter = 0; iter < 40; iter++) {
      for (let i = 0; i < m; i++) {
        for (let j = i + 1; j < m; j++) {
          const a = work[i] as Work;
          const b = work[j] as Work;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          const min = (a.hit + b.hit) * 0.68;
          if (dist >= min) continue;
          if (dist < 0.001) {
            dx = Math.cos(i * 2.4);
            dy = Math.sin(i * 2.4);
            dist = 1;
          }
          const push = (min - dist) / 2 / dist;
          a.x -= dx * push;
          a.y -= dy * push;
          b.x += dx * push;
          b.y += dy * push;
        }
      }
      for (const w of work) {
        const k0 = w.spike ? 1.4 : 1.12;
        const u = (w.x - dome.x) / (dome.rx * k0);
        const v = (w.y - dome.y) / (dome.ry * k0);
        const q = u * u + v * v;
        if (q > 1) {
          const k = 1 / Math.sqrt(q);
          w.x = dome.x + (w.x - dome.x) * k;
          w.y = dome.y + (w.y - dome.y) * k;
        }
      }
    }
    let wsum = 0;
    let cx = 0;
    for (const w of work) {
      wsum += w.r * w.r;
      cx += w.x * w.r * w.r;
    }
    const shift = clamp(dome.x - cx / wsum, -40, 40);
    for (const w of work) w.x += shift;
  }
  const top = Math.min(...work.map((w) => w.y - w.r * (w.spike ? 1.35 : 1.15)));
  if (top < 12) for (const w of work) w.y += 12 - top;
  const bottom = Math.max(...work.map((w) => w.y + w.r));
  if (bottom > BOW.y - 30) for (const w of work) w.y -= bottom - (BOW.y - 30);
  const left = Math.min(...work.map((w) => w.x - w.r * 1.05));
  const right = Math.max(...work.map((w) => w.x + w.r * 1.05));
  if (left < 8) for (const w of work) w.x += 8 - left;
  else if (right > CANVAS_WIDTH - 8) for (const w of work) w.x -= right - (CANVAS_WIDTH - 8);

  // 6. Giro hacia fuera siguiendo el tallo, tono propio y orden de dibujo (las más altas, al fondo).
  const placed = work.map((w): PlacedFlower => {
    const info = FLOWER_INFO[w.mem.flower];
    const rng = mulberry32(fnv1a(`${month}|${w.mem.id}|pose`));
    const lean = leanFromBow(w.x, w.y) * (w.spike ? 1 : 0.7);
    const rot = round1(clamp(lean + jitter(rng, 4), -55, 55));
    const tone = Math.floor(rng() * 3);
    const stem = stemFor(w.x, w.y, rot, (1.9 + 0.032 * w.r) * info.stem, rng);
    return {
      id: w.mem.id,
      flower: w.mem.flower,
      date: w.mem.date,
      x: round1(w.x),
      y: round1(w.y),
      rot,
      scale: round1((w.r / info.radius) * 100) / 100,
      radius: round1(w.r),
      tone,
      seed: `${month}|${w.mem.id}`,
      stemX: stem.x1,
      stem,
    };
  });
  return placed.sort((a, b) => a.y - b.y || a.x - b.x || cmp(a.id, b.id));
}

/** Cuánto relleno lleva un ramo según sus flores visibles. */
function fillerCount(m: number): number {
  if (m <= 0) return 0;
  if (m <= 3) return 5 + m;
  if (m <= 8) return 12;
  if (m <= 13) return 15;
  return 18;
}

const FILLER_CYCLE: readonly FillerKind[] = [
  'sprig',
  'greens',
  'gyps',
  'sprig',
  'sprig',
  'greens',
  'gyps',
];

function placeFiller(
  month: string,
  flowers: readonly PlacedFlower[],
  dome: Dome,
  m: number,
  rng: Rng,
): PlacedFiller[] {
  if (m === 0) return emptyMonthFiller(month, rng);
  const out: PlacedFiller[] = [];
  const count = fillerCount(m);
  // Contorno real de la copa (flores ya colocadas), para que el relleno asome por el borde.
  const cx = flowers.reduce((s, fl) => s + fl.x, 0) / flowers.length;
  const cy = flowers.reduce((s, fl) => s + fl.y, 0) / flowers.length;
  const spread = m === 1 ? 120 : 140;
  const offset = Math.floor(rng() * FILLER_CYCLE.length);
  for (let k = 0; k < count; k++) {
    const kind = FILLER_CYCLE[(k + offset) % FILLER_CYCLE.length] as FillerKind;
    const psi = rad(-spread + ((k + 0.5) / count) * spread * 2 + jitter(rng, 6));
    // Distancia al centro: hasta el borde de la flor más alejada en esa dirección, y algo más.
    let reach = dome.r * 0.6;
    for (const fl of flowers) {
      const along = (fl.x - cx) * Math.sin(psi) - (fl.y - cy) * Math.cos(psi);
      if (along > 0) reach = Math.max(reach, along + fl.radius * 0.25);
    }
    const out1 = kind === 'gyps' ? 0.05 : 0.15;
    let x = cx + Math.sin(psi) * (reach + dome.r * out1);
    let y = cy - Math.cos(psi) * (reach + dome.r * out1);
    x = clamp(x, 40, CANVAS_WIDTH - 40);
    y = clamp(y, 110, BOW.y - 70);
    const rot = round1(clamp(leanFromBow(x, y) + jitter(rng, 8), -80, 80));
    let length = round1(
      (kind === 'sprig'
        ? between(rng, 88, 128)
        : kind === 'greens'
          ? between(rng, 84, 120)
          : between(rng, 46, 62)) * (m === 1 ? 0.8 : 1),
    );
    // La punta no sale del lienzo: si haría falta, la rama es más corta.
    const up = Math.cos(rad(rot));
    const side = Math.sin(rad(rot));
    if (up > 0 && y - up * length < 10) length = round1(Math.max(30, (y - 10) / up));
    if (side > 0 && x + side * length > CANVAS_WIDTH - 10)
      length = round1(Math.max(30, (CANVAS_WIDTH - 10 - x) / side));
    if (side < 0 && x + side * length < 10) length = round1(Math.max(30, (x - 10) / -side));
    out.push({
      kind,
      x: round1(x),
      y: round1(y),
      rot,
      length,
      tone: Math.floor(rng() * 3),
      seed: `${month}|filler|${k}`,
      stem: stemFor(x, y, rot, kind === 'greens' ? 1.9 : 1.4, rng),
    });
  }
  return out;
}

/** Mes vacío: capullos todavía cerrados, un par de ramas verdes y el lazo con su etiqueta. */
function emptyMonthFiller(month: string, rng: Rng): PlacedFiller[] {
  const items: readonly (readonly [FillerKind, number, number, number])[] = [
    ['greens', -38, 214, 118],
    ['greens', 40, 206, 112],
    ['sprig', -24, 250, 96],
    ['sprig', 28, 244, 90],
    ['gyps', -12, 226, 52],
    ['gyps', 16, 232, 50],
    ['bud', -10, 250, 46],
    ['bud', 4, 282, 52],
    ['bud', 17, 244, 44],
  ];
  return items.map(([kind, angle, dist, length], k) => {
    const a = rad(angle + jitter(rng, 3));
    const x = BOW.x + Math.sin(a) * dist;
    const y = BOW.y - Math.cos(a) * dist;
    const rot = round1(angle * 0.9);
    return {
      kind,
      x: round1(x),
      y: round1(y),
      rot,
      length: round1(length),
      tone: Math.floor(rng() * 3),
      seed: `${month}|empty|${k}`,
      stem: stemFor(x, y, rot, kind === 'bud' ? 2.2 : 1.7, rng),
    };
  });
}

/** Busca en la curva el parámetro cuya altura es la más cercana a `y` (dentro de [lo, hi]). */
function tAtY(stem: StemCurve, y: number, lo: number, hi: number): number {
  let best = lo;
  let bestDist = Infinity;
  for (let i = 0; i <= 24; i++) {
    const t = lo + ((hi - lo) * i) / 24;
    const dist = Math.abs(stemPoint(stem, t).y - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

function leafOn(
  stem: StemCurve,
  t: number,
  side: -1 | 1,
  length: number,
  kind: PlacedLeaf['kind'],
  owner: PlacedLeaf['owner'],
  open: number,
  tone: number,
): PlacedLeaf {
  const p = stemPoint(stem, t);
  const tan = stemTangent(stem, t);
  // La tangente va hacia el lazo; la hoja crece hacia arriba y se abre `open` grados a un lado.
  const up = headingDeg({ x: -tan.x, y: -tan.y });
  return {
    x: round1(p.x),
    y: round1(p.y),
    rot: round1(up + side * open),
    length: round1(length),
    kind,
    tone,
    owner,
    t: round1(t * 1000) / 1000,
  };
}

/** Punta de una hoja colocada (la hoja apunta en la dirección de `rot`). */
const leafTip = (l: PlacedLeaf) => ({
  x: l.x + Math.sin(rad(l.rot)) * l.length,
  y: l.y - Math.cos(rad(l.rot)) * l.length,
});

interface LeafCandidate {
  stem: StemCurve;
  owner: PlacedLeaf['owner'];
  kind: PlacedLeaf['kind'];
  t: number;
  side: -1 | 1;
  length: number;
  open: number;
  tone: number;
  score: number;
  leaf: PlacedLeaf;
}

/**
 * Hojas sobre los tallos (D-253). Antes todas caían en la franja estrecha
 * sobre el lazo, donde los tallos convergen, y se amontonaban. Ahora:
 * 1. Se generan candidatas a lo largo de todo el tramo visible de cada tallo, hacia fuera.
 * 2. Se puntúan: mejor si la punta asoma fuera de las flores, si el tallo es de los exteriores
 *    y si queda a media altura; peor cuanto más cerca del lazo.
 * 3. Se eligen de mejor a peor respetando una distancia mínima entre bases y entre puntas, con
 *    como mucho una hoja por lado junto al lazo. Todo es determinista.
 */
function placeLeaves(
  flowers: readonly PlacedFlower[],
  filler: readonly PlacedFiller[],
  m: number,
  rng: Rng,
): PlacedLeaf[] {
  const target = m === 0 ? 4 : m === 1 ? 4 : m <= 3 ? 6 : m <= 8 ? 9 : m <= 13 ? 11 : 13;
  const scale = m === 0 ? 1.1 : m === 1 ? 1.45 : m <= 3 ? 1.3 : m <= 8 ? 1.2 : 1.15;
  const heads = flowers.map((fl) => ({ x: fl.x, y: fl.y, r: fl.radius * 0.88 }));
  const covered = (x: number, y: number) =>
    heads.some((h) => (h.x - x) ** 2 + (h.y - y) ** 2 < h.r * h.r);

  const sources: {
    stem: StemCurve;
    owner: PlacedLeaf['owner'];
    kind: PlacedLeaf['kind'];
    top: number;
    x: number;
  }[] = [];
  flowers.forEach((fl, index) => {
    if (FLOWER_INFO[fl.flower].role === 'spike' && m > 3) return;
    sources.push({
      stem: fl.stem,
      owner: { kind: 'flower', index },
      kind: FLOWER_INFO[fl.flower].leaf,
      top: fl.y + fl.radius * 0.75,
      x: fl.x,
    });
  });
  filler.forEach((fi, index) => {
    if (fi.kind !== 'greens' && fi.kind !== 'bud') return;
    sources.push({
      stem: fi.stem,
      owner: { kind: 'filler', index },
      kind: 'lance',
      top: fi.y + (fi.kind === 'bud' ? fi.length * 0.25 : fi.length * 0.1),
      x: fi.x,
    });
  });

  const candidates: LeafCandidate[] = [];
  for (const src of sources) {
    const tTop = tAtY(src.stem, Math.min(src.top, BOW.y - 60), 0.02, 0.9);
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = tTop + ((0.9 - tTop) * i) / steps;
      if (t <= 0 || t >= 0.95) continue;
      const p = stemPoint(src.stem, t);
      if (p.y > BOW.y - 30) continue;
      const outward: -1 | 1 = p.x < BOW.x - 2 ? -1 : p.x > BOW.x + 2 ? 1 : i % 2 ? 1 : -1;
      for (const side of [outward, -outward as -1 | 1]) {
        const base = src.kind === 'strap' ? 54 : src.kind === 'broad' ? 42 : 40;
        const length = base * scale * between(rng, 0.88, 1.08);
        const open = between(rng, 36, 54);
        const tone = Math.floor(rng() * 3);
        const leaf = leafOn(src.stem, t, side, length, src.kind, src.owner, open, tone);
        const tip = leafTip(leaf);
        if (tip.x < 14 || tip.x > CANVAS_WIDTH - 14 || tip.y < 14) continue;
        // Una hoja que queda entera detrás de una flor no se ve: no se coloca.
        if (covered(leaf.x, leaf.y) && covered(tip.x, tip.y)) continue;
        // Se prefieren las hojas que se ven: punta fuera de las flores y base en el tramo libre
        // del tallo, hacia fuera y en los tallos exteriores. Justo encima del lazo, no.
        if (p.y > BOW.y - 42) continue;
        const score =
          (covered(tip.x, tip.y) ? 0 : 2.2) +
          (covered(leaf.x, leaf.y) ? 0 : 1) +
          (side === outward ? 1.2 : 0) +
          Math.min(1, Math.abs(src.x - BOW.x) / 120) +
          rng() * 0.6;
        candidates.push({ ...src, t, side, length, open, tone, score, leaf });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.leaf.y - b.leaf.y || a.leaf.x - b.leaf.x);

  const out: PlacedLeaf[] = [];
  const tips: { x: number; y: number }[] = [];
  let bowLeft = 0;
  let bowRight = 0;
  for (const c of candidates) {
    if (out.length >= target) break;
    const l = c.leaf;
    const tip = leafTip(l);
    const minBase = Math.max(18, l.length * 0.55);
    const minTip = Math.max(22, l.length * 0.7);
    if (out.some((o) => Math.hypot(o.x - l.x, o.y - l.y) < minBase)) continue;
    if (tips.some((q) => Math.hypot(q.x - tip.x, q.y - tip.y) < minTip)) continue;
    // Cerca del lazo, donde los tallos se juntan, como mucho dos hojas por lado.
    if (l.y > BOW.y - 95) {
      if (tip.x < BOW.x ? bowLeft >= 2 : bowRight >= 2) continue;
      if (tip.x < BOW.x) bowLeft++;
      else bowRight++;
    }
    out.push(l);
    tips.push(tip);
  }
  return out;
}

const POLAROID = { w: 92, h: 110, photo: { x: -39, y: -47, w: 78, h: 78 } } as const;
const TILTS = [-7, 6, -4, 8, -5] as const;
/** Sectores (grados desde arriba) para cada foto: derecha arriba, izquierda abajo, izquierda arriba, derecha abajo, abajo. */
const SECTORS: readonly (readonly [number, number])[] = [
  [40, 90],
  [-140, -95],
  [-90, -40],
  [95, 140],
  [-150, 150],
];

/** Cuánto taparía una Polaroid centrada en (x, y) los centros de las flores (0 = nada). */
function coverage(x: number, y: number, flowers: readonly PlacedFlower[]): number {
  let sum = 0;
  for (const fl of flowers) {
    const core = fl.radius * 0.62;
    const ox = POLAROID.w / 2 + core - Math.abs(fl.x - x);
    const oy = POLAROID.h / 2 + core - Math.abs(fl.y - y);
    if (ox > 0 && oy > 0)
      sum += (Math.min(ox, 2 * core) * Math.min(oy, 2 * core)) / (4 * core * core);
  }
  return sum;
}

function placePolaroids(
  sorted: readonly BouquetMemory[],
  flowers: readonly PlacedFlower[],
  dome: Dome,
  rng: Rng,
): PlacedPolaroid[] {
  // Los 5 recuerdos con foto más recientes; de izquierda a derecha en orden cronológico.
  const chosen = sorted.filter((mem) => mem.hasPhoto).slice(-MAX_POLAROIDS);
  const n = chosen.length;
  if (n === 0) return [];
  const halfW = POLAROID.w / 2 + 4;
  const halfH = POLAROID.h / 2 + 8;
  const ex = Math.max(dome.rx + dome.r * 0.55, 150);
  const ey = Math.max(dome.ry + dome.r * 0.45, 130);

  // Candidatos alrededor de la copa (cada 10°, sin la zona del lazo) a varias distancias.
  interface Spot {
    x: number;
    y: number;
    angle: number;
    score: number;
    /** Dejaría el centro de alguna flor debajo de la foto. */
    hides: boolean;
  }
  const spots: Spot[] = [];
  for (let angle = -150; angle <= 150; angle += 10) {
    for (const k of [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5]) {
      const a = rad(angle);
      const x = clamp(dome.x + Math.sin(a) * ex * k, halfW, CANVAS_WIDTH - halfW);
      const y = clamp(dome.y - Math.cos(a) * ey * k, halfH, CANVAS_HEIGHT - halfH);
      if (Math.abs(x - BOW.x) < 64 + halfW && y + halfH > BOW.y - 46) continue; // ni sobre el lazo
      // Tapa poco, queda cerca del borde de la copa y prefiere los lados a la parte de arriba.
      const hides = flowers.some((fl) => Math.abs(fl.x - x) < halfW && Math.abs(fl.y - y) < halfH);
      const score = coverage(x, y, flowers) * 4 + Math.abs(k - 0.95) + (hides ? 50 : 0);
      spots.push({ x, y, angle, score, hides });
    }
  }
  // Un sector por foto, alternando lados para que el ramo quede equilibrado.
  const picked: Spot[] = [];
  const free = (s: Spot) =>
    picked.every(
      (p) => Math.abs(p.x - s.x) > POLAROID.w * 0.9 || Math.abs(p.y - s.y) > POLAROID.h * 0.9,
    );
  const bestOf = (lo: number, hi: number): Spot | null => {
    let best: Spot | null = null;
    for (const s of spots) {
      if (s.angle < lo || s.angle > hi || !free(s)) continue;
      if (!best || s.score < best.score) best = s;
    }
    return best;
  };
  for (const [lo, hi] of SECTORS.slice(0, n)) {
    let best = bestOf(lo, hi);
    // Si en su sector solo cabe tapando una flor, se busca sitio en cualquier otro lado.
    if (!best || best.hides) {
      const anywhere = bestOf(-180, 180);
      if (anywhere && (!best || anywhere.score < best.score)) best = anywhere;
    }
    if (best) picked.push(best);
  }
  picked.sort((a, b) => a.x - b.x || a.y - b.y);
  // Si no cupieran todas, se quedan las más recientes.
  return chosen.slice(chosen.length - picked.length).map((mem, k): PlacedPolaroid => {
    const s = picked[k] as Spot;
    return {
      id: mem.id,
      flower: mem.flower,
      x: round1(s.x),
      y: round1(s.y),
      rot: round1((TILTS[k] as number) + jitter(rng, 1.5)),
      w: POLAROID.w,
      h: POLAROID.h,
      photo: POLAROID.photo,
      tape: Math.floor(rng() * 3),
    };
  });
}
