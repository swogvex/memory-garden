import {
  Defs,
  HEADS,
  esc,
  f,
  fnv1a,
  jitter,
  leaf,
  makeRng,
  mulberry32,
  type Detail,
  type Rng,
} from '@/lib/flowers';
import { TEXTURE_PATH, washPlacement } from './export-plan';
import { renderFiller } from './filler';
import type { BouquetLayout, PlacedFlower, PlacedPolaroid, StemCurve } from './model';
import { stemPath } from './stem-geometry';

export interface RenderLabels {
  /** Nombre accesible del dibujo entero. */
  readonly root: string;
  /** Nombre accesible de una flor («Rosa, título, 14 de octubre»). */
  flower(flower: PlacedFlower): string;
  /** Nombre accesible del grupo «+N más». */
  overflow(count: number): string;
  /** Texto visible del grupo («+79 más»); solo se dibuja con `text: true`. */
  readonly overflowText?: string;
}

export interface RenderOptions {
  /** Prefijo único por documento para los identificadores internos. */
  readonly idPrefix: string;
  readonly detail: Exclude<Detail, 'icon'>;
  readonly labels: RenderLabels;
  /** Flores y «+N más» enfocables y con nombre accesible. */
  readonly interactive: boolean;
  /** Dibuja las Polaroids (si el diseño las incluye). */
  readonly polaroids: boolean;
  /** Dibuja las manchas de acuarela del fondo. */
  readonly wash: boolean;
  /** Color de fondo opaco (exportación); `null` = transparente. */
  readonly background: string | null;
  /** Incluir `<text>` (en la página sí; en la exportación el texto se dibuja aparte). */
  readonly text: boolean;
  /** URL `blob:` de la foto de cada recuerdo; sin ella, el hueco queda vacío. */
  readonly images?: Readonly<Record<string, string>>;
  /** Tamaño en píxeles (`width`/`height`); sin él, el SVG se adapta a su contenedor. */
  readonly size?: { readonly width: number; readonly height: number };
  /**
   * Textura WebP de mancha de acuarela (solo el ramo grande de la página; nunca miniaturas).
   * Solo se acepta la ruta propia (`/textures/wash.webp`); cualquier otra se ignora.
   */
  readonly washTexture?: string;
}

/** Aro de foco: invisible por defecto; la hoja de estilos lo muestra con `:focus-visible`. */
const RING = 'fill="none" stroke="#5b3f8f" stroke-width="3" opacity="0" pointer-events="none"';
const STEMS = ['#7a8f70', '#82987a', '#73896f'] as const;
const STEM_LIGHT = '#c3d1b8';

/** Devuelve el SVG del ramo como texto. No lee datos, claves ni almacenamiento: solo dibuja. */
export function renderBouquet(layout: BouquetLayout, o: RenderOptions): string {
  const defs = new Defs(o.idPrefix);
  const wash = o.wash ? washBlobs(defs, layout) : '';
  let texture = '';
  if (o.washTexture && TEXTURE_PATH.test(o.washTexture)) {
    const w = washPlacement(layout);
    texture = `<image href="${esc(o.washTexture)}" x="${f(w.x - w.size / 2)}" y="${f(w.y - w.size / 2)}" width="${w.size}" height="${w.size}" opacity=".85" preserveAspectRatio="none"/>`;
  }

  // Tallos: los del relleno primero (más finos, al fondo) y luego los de las flores.
  let stems = '';
  for (const fi of layout.filler) stems += stemMarkup(fi.stem, o.detail);
  for (const fl of layout.flowers) stems += stemMarkup(fl.stem, o.detail);

  let leaves = '';
  for (const l of layout.leaves)
    leaves += leaf(defs, o.detail, l.kind, l.x, l.y, l.rot, l.length, l.tone);

  let filler = '';
  for (const fi of layout.filler) filler += renderFiller(defs, o.detail, fi);

  let flowersMarkup = '';
  layout.flowers.forEach((fl, index) => {
    const head = HEADS[fl.flower]({
      rng: makeRng(`${fl.seed}|head`),
      defs,
      detail: o.detail,
      tone: fl.tone,
    });
    const body = `<g transform="translate(${f(fl.x)} ${f(fl.y)}) rotate(${f(fl.rot)}) scale(${f(fl.scale)})">${head.body}</g>`;
    if (o.interactive) {
      const ring = `<circle class="mg-ring" cx="${f(fl.x)}" cy="${f(fl.y)}" r="${f(fl.radius + 7)}" ${RING}/>`;
      flowersMarkup += `<g class="mg-fl mg-in d${index % 8}" role="button" tabindex="0" data-id="${esc(fl.id)}" aria-label="${esc(o.labels.flower(fl))}">${body}${ring}</g>`;
    } else {
      flowersMarkup += body;
    }
  });

  const bow = ribbon(defs, layout.base.x, layout.base.y, layout.bowScale);
  const photos = o.polaroids ? polaroids(defs, layout.polaroids, o) : '';
  const more = layout.overflow ? overflow(defs, layout.overflow, o) : '';
  const bg = o.background
    ? `<rect width="${layout.width}" height="${layout.height}" fill="${o.background}"/>`
    : '';
  const sizeAttr = o.size ? ` width="${o.size.width}" height="${o.size.height}"` : '';
  const role = o.interactive ? 'group' : 'img';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}"${sizeAttr} role="${role}" aria-label="${esc(o.labels.root)}">` +
    `${defs}${bg}` +
    `<g aria-hidden="true">${texture}${wash}${stems}${leaves}${filler}</g>` +
    `${flowersMarkup}<g aria-hidden="true">${bow}${photos}</g>${more}</svg>`
  );
}

function stemMarkup(s: StemCurve, detail: Detail): string {
  const d = stemPath(s);
  let out = `<path d="${d}" fill="none" stroke="${STEMS[s.tone % 3]}" stroke-width="${f(s.width)}" stroke-linecap="round"/>`;
  if (detail === 'full' && s.width > 1.8) {
    out += `<path d="${d}" fill="none" stroke="${STEM_LIGHT}" stroke-opacity=".55" stroke-width="${f(s.width * 0.3)}" stroke-linecap="round" transform="translate(${f(-s.width * 0.2)} 0)"/>`;
  }
  return out;
}

/** Contorno irregular cerrado (mancha de acuarela) alrededor de (cx, cy). */
function blob(rng: Rng, cx: number, cy: number, rx: number, ry: number, points = 9): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const k = 1 + jitter(rng, 0.16);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  // Curvas cuadráticas por los puntos medios: un contorno suave sin esquinas.
  const mid = (p: [number, number], q: [number, number]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const first = mid(pts[points - 1] as [number, number], pts[0] as [number, number]);
  let d = `M${f(first[0] as number)} ${f(first[1] as number)}`;
  for (let i = 0; i < points; i++) {
    const p = pts[i] as [number, number];
    const q = mid(p, pts[(i + 1) % points] as [number, number]);
    d += `Q${f(p[0])} ${f(p[1])} ${f(q[0] as number)} ${f(q[1] as number)}`;
  }
  return `${d}Z`;
}

/**
 * Fondo de acuarela en SVG puro: manchas irregulares con degradado y un borde algo más oscuro
 * (el «cerco» que deja el agua al secarse). Sin filtros SVG (D-149).
 */
function washBlobs(defs: Defs, layout: BouquetLayout): string {
  const rng = mulberry32(fnv1a(`${layout.seed}|wash`));
  const { dome } = layout;
  const empty = layout.flowers.length === 0;
  const rx = Math.max(dome.rx, 120) + 40;
  const ry = Math.max(dome.ry, 110) + 40;
  const cy = empty ? layout.base.y - 210 : dome.y + 10;
  const specs = [
    ['#dcd0f0', 0, -0.05, 1, 0.5],
    ['#e8c8d1', -0.3, 0.2, 0.68, 0.38],
    ['#cfdac8', 0.32, 0.26, 0.62, 0.34],
  ] as const;
  let out = '';
  specs.forEach(([color, dx, dy, k, opacity], i) => {
    const key = `wash-${i}`;
    defs.radial(
      key,
      [
        [0, color, 0.45],
        [0.8, color, 0.6],
        [1, color, 0.85],
      ],
      50,
      50,
      60,
    );
    const x = 300 + dx * rx + jitter(rng, 14);
    const y = cy + dy * ry + jitter(rng, 12);
    const d = blob(rng, x, y, rx * k, ry * k);
    out += `<path d="${d}" fill="${defs.ref(key)}" opacity="${f(opacity)}" stroke="${color}" stroke-width="1.5" stroke-opacity=".7"/>`;
  });
  return out;
}

/** Lazo pastel: banda que recoge los tallos, lazadas con pliegues, caídas en cola de golondrina y etiqueta. */
function ribbon(defs: Defs, x: number, y: number, scale: number): string {
  defs.radial(
    'ribbon',
    [
      [0, '#a993d2'],
      [0.55, '#c8b7e6'],
      [1, '#e9e1f6'],
    ],
    50,
    90,
    110,
  );
  const fill = `fill="${defs.ref('ribbon')}" stroke="#7f68ad" stroke-opacity=".45" stroke-width=".9"`;
  const fold = 'fill="#7f68ad" fill-opacity=".22"';
  const loopL = 'M-6 0C-22-30-66-42-76-12C-82 8-58 22-6 6Z';
  const loopFoldL = 'M-8 2C-26-10-50-14-66-6C-52-20-28-18-8 2Z';
  const tailL = 'M-6 8C-14 34-26 66-44 108L-30 100L-22 116C-8 78 0 44 3 10Z';
  const tailR = 'M5 8C14 30 24 60 34 96L46 86L52 102C40 66 18 34 10 7Z';
  return (
    `<g transform="translate(${f(x)} ${f(y)}) scale(${f(scale)})">` +
    `<path d="M-23-9C-8-4 8-4 23-9L23 10C8 15-8 15-23 10Z" ${fill}/>` +
    `<path d="M-23 4C-8 9 8 9 23 4L23 10C8 15-8 15-23 10Z" ${fold}/>` +
    `<path d="${tailL}" ${fill}/><path d="${tailR}" ${fill}/>` +
    `<path d="M-4 12C-10 40-20 70-34 100L-30 100C-16 70-6 42 1 12Z" ${fold}/>` +
    `<path d="${loopL}" ${fill}/><path d="${loopL}" transform="scale(-1 1)" ${fill}/>` +
    `<path d="${loopFoldL}" ${fold}/><path d="${loopFoldL}" transform="scale(-1 1)" ${fold}/>` +
    `<path d="M-13-7C-15 2-13 11-8 14C-2 16 6 15 10 12C14 6 14-4 11-9C4-12-6-12-13-7Z" ${fill}/>` +
    `<path d="M-50-22C-38-30-22-26-12-12M50-22C38-30 22-26 12-12" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>` +
    tag() +
    `</g>`
  );
}

/** Etiqueta colgada del nudo con un cordel; dibujo lineal de una flor (sin texto). */
function tag(): string {
  return (
    `<path d="M4 6C14 22 22 38 30 52" fill="none" stroke="#b9a98c" stroke-width="1" stroke-linecap="round"/>` +
    `<g transform="translate(36 80) rotate(-14)">` +
    `<path d="M-11-27L11-27L18-19L18 27L-18 27L-18-19Z" fill="#fcf8ef" stroke="#cbbca2" stroke-width="1"/>` +
    `<circle cy="-19" r="2.6" fill="#fff" stroke="#cbbca2" stroke-width=".8"/>` +
    `<g fill="none" stroke="#9f86c8" stroke-width="1" stroke-linecap="round">` +
    `<path d="M0 20C-1 10 0 4 0-2M0 12C-4 9-7 10-8 12M0 9C4 6 7 7 8 9"/>` +
    `<path d="M0-2C-5-2-7-8-3-10C-4-15 4-15 3-10C7-8 5-2 0-2Z"/>` +
    `<circle cy="-6" r="1.4"/>` +
    `</g></g>`
  );
}

const TAPES = ['#e8c8d1', '#dcd0f0', '#d5e0cc'] as const;

function polaroids(defs: Defs, items: readonly PlacedPolaroid[], o: RenderOptions): string {
  if (items.length === 0) return '';
  const p = items[0] as PlacedPolaroid;
  defs.put(
    'pclip',
    `<clipPath id="${defs.id('pclip')}"><rect x="${p.photo.x}" y="${p.photo.y}" width="${p.photo.w}" height="${p.photo.h}"/></clipPath>`,
  );
  defs.radial(
    'pempty',
    [
      [0, '#f3eef9'],
      [1, '#e2d8f1'],
    ],
    50,
    40,
    80,
  );
  let out = '';
  for (const it of items) {
    const { w, h, photo } = it;
    const url = o.images?.[it.id];
    const image =
      url && url.startsWith('blob:')
        ? `<image href="${esc(url)}" x="${photo.x}" y="${photo.y}" width="${photo.w}" height="${photo.h}" preserveAspectRatio="xMidYMid slice" clip-path="${defs.ref('pclip')}"/>`
        : '';
    const tape = TAPES[it.tape % 3] as string;
    out +=
      `<g class="mg-pol" data-id="${esc(it.id)}" pointer-events="none" transform="translate(${f(it.x)} ${f(it.y)}) rotate(${f(it.rot)})">` +
      `<rect x="${f(-w / 2 + 2)}" y="${f(-h / 2 + 4)}" width="${w}" height="${h}" rx="2" fill="#37313f" fill-opacity=".12"/>` +
      `<rect x="${f(-w / 2)}" y="${f(-h / 2)}" width="${w}" height="${h}" rx="2" fill="#fffdf9" stroke="#e4dccf" stroke-width=".8"/>` +
      `<rect x="${photo.x}" y="${photo.y}" width="${photo.w}" height="${photo.h}" fill="${defs.ref('pempty')}"/>${image}` +
      `<path d="M-23-7L23-7L21-3.5L23 0L21 3.5L23 7L-23 7L-21 3.5L-23 0L-21-3.5Z" transform="translate(0 ${f(-h / 2 + 1)}) rotate(-5)" fill="${tape}" fill-opacity=".8"/>` +
      `</g>`;
  }
  return out;
}

/** Racimo de capullos con la cuenta de recuerdos que no caben como flor. */
function overflow(
  defs: Defs,
  at: NonNullable<BouquetLayout['overflow']>,
  o: RenderOptions,
): string {
  defs.radial(
    'bud',
    [
      [0, '#a892d0'],
      [0.6, '#d3c0e8'],
      [1, '#f4e6f1'],
    ],
    40,
    70,
    80,
  );
  const buds: readonly (readonly [number, number, number])[] = [
    [-14, 6, 9],
    [4, 10, 10],
    [18, 2, 8],
    [-4, -8, 9],
    [10, -9, 8],
  ];
  let inner = '';
  for (const [dx, dy, r] of buds) {
    inner += `<circle cx="${dx}" cy="${dy}" r="${r}" fill="${defs.ref('bud')}" stroke="#7f68ad" stroke-opacity=".4" stroke-width="1"/>`;
  }
  const text =
    o.text && o.labels.overflowText
      ? `<text y="42" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="17" font-weight="600" fill="#37313f">${esc(o.labels.overflowText)}</text>`
      : '';
  const ring = `<circle class="mg-ring" r="34" ${RING}/>`;
  const attrs = o.interactive
    ? ` class="mg-more" role="button" tabindex="0" data-more="1" aria-label="${esc(o.labels.overflow(at.count))}"`
    : ' aria-hidden="true"';
  return `<g${attrs} transform="translate(${f(at.x)} ${f(at.y)})">${inner}${text}${ring}</g>`;
}
