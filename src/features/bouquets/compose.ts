import { FLOWER_INFO, between, fnv1a, jitter, mulberry32, type FlowerId } from '@/lib/flowers';
import type {
  BouquetInput,
  BouquetLayout,
  BouquetMemory,
  PlacedFlower,
  PlacedLeaf,
  PlacedPolaroid,
} from './model';

export const CANVAS_WIDTH = 600;
export const HEIGHT_FLOWERS = 640;
export const HEIGHT_PHOTOS = 790;
export const MAX_FLOWERS = 21;
export const MAX_POLAROIDS = 5;

const CENTER_X = 300;
const CENTER_Y = 262;
const BASE = { x: 300, y: 568 } as const;
const RX_MAX = 205;
const ASPECT = 1.1;
const COVERAGE = 1.3;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Con pocas flores se bajan para acortar el tallo. */
const LOWER: Readonly<Record<number, number | undefined>> = { 1: 60, 2: 40, 3: 22 };
const RANK = { focal: 0, mid: 1, spike: 2 } as const;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const round1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const hex = (n: number) => n.toString(16).padStart(8, '0');

/**
 * Compone el ramo de un mes. Es una función pura y determinista: la misma entrada da siempre
 * el mismo resultado, sin azar real, sin reloj y sin depender del orden de la lista.
 * Algoritmo documentado en `docs/ramos-algoritmo.md`.
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

  const flowers = placeFlowers(input.month, visible, sub);
  const leaves = placeLeaves(flowers, m, sub('leaves'));
  const polaroids = placePolaroids(sorted, sub('polaroids'));

  return {
    month: input.month,
    seed: hex(seed),
    width: CANVAS_WIDTH,
    height: polaroids.length > 0 ? HEIGHT_PHOTOS : HEIGHT_FLOWERS,
    total,
    flowers,
    leaves,
    base: BASE,
    polaroids,
    overflow: total > m ? { count: total - m, x: 512, y: 526 } : null,
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
  if (m >= 6) return 50;
  return [0, 88, 74, 64, 58, 54][m] as number;
}

interface Slot {
  x: number;
  y: number;
  d: number;
}

function placeFlowers(
  month: string,
  visible: readonly BouquetMemory[],
  sub: (label: string) => () => number,
): PlacedFlower[] {
  const m = visible.length;
  if (m === 0) return [];
  const rBase = baseRadius(m);
  const area = (m * Math.PI * rBase * rBase) / COVERAGE;
  const rx = Math.min(RX_MAX, Math.sqrt((area * ASPECT) / Math.PI));
  const ry = rx / ASPECT;

  // 3. Posiciones: espiral de Vogel dentro de una elipse. Las primeras quedan en el centro.
  const phase = sub('phase')() * Math.PI * 2;
  const slots: Slot[] = [];
  for (let i = 0; i < m; i++) {
    const d = m === 1 ? 0 : Math.sqrt((i + 0.5) / m);
    const a = phase + i * GOLDEN_ANGLE;
    slots.push({
      x: CENTER_X + rx * d * Math.cos(a),
      y: CENTER_Y + (LOWER[m] ?? 0) + ry * d * Math.sin(a),
      d,
    });
  }

  // 4. Reparto: las flores grandes al centro, las medianas después y las espigas en el borde.
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
    scale: number;
  }
  const work: Work[] = order.map(({ mem }, i) => {
    const slot = slots[i] as Slot;
    const info = FLOWER_INFO[mem.flower];
    const r = rBase * info.size * (1 - 0.16 * slot.d);
    return {
      mem,
      x: slot.x,
      y: slot.y,
      r,
      hit: info.role === 'spike' ? r * 0.6 : r,
      scale: r / info.radius,
    };
  });

  // 5. Equilibrio: separar solapes excesivos, mantener dentro de la elipse y centrar la masa.
  if (m > 1) {
    for (let iter = 0; iter < 40; iter++) {
      for (let i = 0; i < m; i++) {
        for (let j = i + 1; j < m; j++) {
          const a = work[i] as Work;
          const b = work[j] as Work;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          const min = (a.hit + b.hit) * 0.72;
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
        const u = (w.x - CENTER_X) / (rx * 1.12);
        const v = (w.y - CENTER_Y) / (ry * 1.12);
        const q = u * u + v * v;
        if (q > 1) {
          const k = 1 / Math.sqrt(q);
          w.x = CENTER_X + (w.x - CENTER_X) * k;
          w.y = CENTER_Y + (w.y - CENTER_Y) * k;
        }
      }
    }
    let wsum = 0;
    let cx = 0;
    for (const w of work) {
      wsum += w.r * w.r;
      cx += w.x * w.r * w.r;
    }
    const shift = clamp(CENTER_X - cx / wsum, -40, 40);
    for (const w of work) w.x += shift;
  }
  const top = Math.min(...work.map((w) => w.y - w.r * 1.15));
  if (top < 14) for (const w of work) w.y += 14 - top;
  const left = Math.min(...work.map((w) => w.x - w.r * 1.05));
  const right = Math.max(...work.map((w) => w.x + w.r * 1.05));
  if (left < 8) for (const w of work) w.x += 8 - left;
  else if (right > CANVAS_WIDTH - 8) for (const w of work) w.x -= right - (CANVAS_WIDTH - 8);

  // 6. Giro hacia fuera, tono propio y orden de dibujo (las más altas, al fondo).
  const placed = work.map((w): PlacedFlower => {
    const info = FLOWER_INFO[w.mem.flower];
    const rng = mulberry32(fnv1a(`${month}|${w.mem.id}|pose`));
    const lean = info.role === 'spike' ? 1.5 : 1;
    const rot = clamp(((w.x - CENTER_X) / rx) * 24 * lean, -40, 40) + jitter(rng, 5);
    return {
      id: w.mem.id,
      flower: w.mem.flower,
      date: w.mem.date,
      x: round1(w.x),
      y: round1(w.y),
      rot: round1(rot),
      scale: round1(w.scale * 100) / 100,
      radius: round1(w.r),
      tone: Math.floor(rng() * 3),
      seed: `${month}|${w.mem.id}`,
      stemX: round1(clamp(BASE.x + (w.x - CENTER_X) * 0.09, BASE.x - 26, BASE.x + 26)),
    };
  });
  return placed.sort((a, b) => a.y - b.y || a.x - b.x || cmp(a.id, b.id));
}

function placeLeaves(flowers: readonly PlacedFlower[], m: number, rng: () => number): PlacedLeaf[] {
  const out: PlacedLeaf[] = [];
  const kinds = [...new Set(flowers.map((f) => FLOWER_INFO[f.flower].leaf))].sort();
  const kindAt = (): PlacedLeaf['kind'] =>
    (kinds.length === 0 ? 'lance' : kinds[Math.floor(rng() * kinds.length)]) as PlacedLeaf['kind'];

  if (m === 0) {
    // Mes vacío: un brote de tres hojas.
    for (const [rot, length] of [
      [-24, 150],
      [0, 176],
      [24, 150],
    ] as const) {
      out.push({ x: BASE.x, y: BASE.y - 6, rot, length, kind: 'lance', tone: 0 });
    }
    return out;
  }

  const rBase = baseRadius(m);
  const area = (m * Math.PI * rBase * rBase) / COVERAGE;
  const rx = Math.min(RX_MAX, Math.sqrt((area * ASPECT) / Math.PI));
  const ry = rx / ASPECT;
  const count = clamp(Math.round(m * 0.55) + 3, 3, 14);
  for (let k = 0; k < count; k++) {
    const phi = ((-205 + ((k + 0.5) / count) * 230 + jitter(rng, 6)) * Math.PI) / 180;
    const radial = Math.hypot(rx * Math.cos(phi), ry * Math.sin(phi));
    out.push({
      x: round1(CENTER_X + rx * 0.45 * Math.cos(phi)),
      y: round1(CENTER_Y + ry * 0.45 * Math.sin(phi)),
      rot: round1((phi * 180) / Math.PI + 90),
      length: round1(clamp(radial * 0.55 + 38 + between(rng, 0, 30), 60, 150)),
      kind: kindAt(),
      tone: Math.floor(rng() * 3),
    });
  }
  // Hojas del tallo, a los lados del lazo.
  const side = m <= 3 ? 1 : 2;
  for (let k = 0; k < side; k++) {
    for (const dir of [-1, 1] as const) {
      out.push({
        x: BASE.x + dir * 5,
        y: BASE.y - 16 - k * 14,
        rot: round1(dir * (52 + k * 14 + between(rng, 0, 12))),
        length: round1(between(rng, 112, 146)),
        kind: kindAt(),
        tone: Math.floor(rng() * 3),
      });
    }
  }
  return out;
}

const POLAROID = { w: 108, h: 132, photo: { x: -46, y: -58, w: 92, h: 92 } } as const;
const TILT = [-8, 5, -3, 7, -6] as const;

function placePolaroids(sorted: readonly BouquetMemory[], rng: () => number): PlacedPolaroid[] {
  // Los 5 recuerdos con foto más recientes, de izquierda a derecha en orden cronológico.
  const chosen = sorted.filter((mem) => mem.hasPhoto).slice(-MAX_POLAROIDS);
  const n = chosen.length;
  const gap = n > 1 ? Math.min(112, 440 / (n - 1)) : 0;
  return chosen.map((mem, k): PlacedPolaroid => ({
    id: mem.id,
    flower: mem.flower,
    x: round1(CANVAS_WIDTH / 2 + (k - (n - 1) / 2) * gap),
    y: round1(700 + (k % 2 === 0 ? -6 : 6)),
    rot: round1((TILT[k] as number) + jitter(rng, 1.5)),
    w: POLAROID.w,
    h: POLAROID.h,
    photo: POLAROID.photo,
  }));
}

export type { FlowerId };
