import {
  Defs,
  FLOWER_INFO,
  HEADS,
  esc,
  f,
  fnv1a,
  leaf,
  makeRng,
  mulberry32,
  stem,
  type Detail,
} from '@/lib/flowers';
import type { BouquetLayout, PlacedFlower, PlacedPolaroid } from './model';

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
}

const RIBBON = ['#5b3f8f', '#7a5fa8', '#b8a0d9'] as const;
/** Aro de foco: invisible por defecto; la hoja de estilos lo muestra con `:focus-visible`. */
const RING = 'fill="none" stroke="#5b3f8f" stroke-width="3" opacity="0" pointer-events="none"';

/** Devuelve el SVG del ramo como texto. No lee datos, claves ni almacenamiento: solo dibuja. */
export function renderBouquet(layout: BouquetLayout, o: RenderOptions): string {
  const defs = new Defs(o.idPrefix);
  const height = o.polaroids ? layout.height : Math.min(layout.height, 640);
  const wash = o.wash ? washBlobs(defs, layout) : '';

  let flowersMarkup = '';
  let stems = '';
  layout.flowers.forEach((fl, index) => {
    const info = FLOWER_INFO[fl.flower];
    const head = HEADS[fl.flower]({
      rng: makeRng(`${fl.seed}|head`),
      defs,
      detail: o.detail,
      tone: fl.tone,
    });
    const th = (fl.rot * Math.PI) / 180;
    const ay = head.attach.y - 8;
    const ax = fl.x + fl.scale * (head.attach.x * Math.cos(th) - ay * Math.sin(th));
    const ayw = fl.y + fl.scale * (head.attach.x * Math.sin(th) + ay * Math.cos(th));
    stems += stem(
      o.detail,
      ax,
      ayw,
      fl.stemX,
      layout.base.y,
      (2.2 + 0.035 * fl.radius) * info.stem,
      (fl.x - layout.base.x) * 0.08,
    );
    const body = `<g transform="translate(${f(fl.x)} ${f(fl.y)}) rotate(${f(fl.rot)}) scale(${f(fl.scale)})">${head.body}</g>`;
    if (o.interactive) {
      const ring = `<circle class="mg-ring" cx="${f(fl.x)}" cy="${f(fl.y)}" r="${f(fl.radius + 7)}" ${RING}/>`;
      flowersMarkup += `<g class="mg-fl mg-in d${index % 8}" role="button" tabindex="0" data-id="${esc(fl.id)}" aria-label="${esc(o.labels.flower(fl))}">${body}${ring}</g>`;
    } else {
      flowersMarkup += body;
    }
  });

  let leaves = '';
  let baseLeaves = '';
  for (const l of layout.leaves) {
    const markup = leaf(defs, o.detail, l.kind, l.x, l.y, l.rot, l.length, l.tone);
    if (l.y > layout.base.y - 60) baseLeaves += markup;
    else leaves += markup;
  }

  const bow = ribbon(defs, layout.base.x, layout.base.y);
  const photos = o.polaroids ? polaroids(defs, layout.polaroids, o) : '';
  const more = layout.overflow ? overflow(defs, layout.overflow, o) : '';
  const bg = o.background
    ? `<rect width="${layout.width}" height="${height}" fill="${o.background}"/>`
    : '';
  const sizeAttr = o.size ? ` width="${o.size.width}" height="${o.size.height}"` : '';
  const role = o.interactive ? 'group' : 'img';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${height}"${sizeAttr} role="${role}" aria-label="${esc(o.labels.root)}">` +
    `${defs}${bg}${wash}${leaves}${stems}${baseLeaves}${bow}${flowersMarkup}${photos}${more}</svg>`
  );
}

function washBlobs(defs: Defs, layout: BouquetLayout): string {
  const rng = mulberry32(fnv1a(`${layout.seed}|wash`));
  const colors = ['#e8c8d1', '#dcd0f0', '#cfdac8'] as const;
  let out = '';
  colors.forEach((color, i) => {
    const key = `wash-${i}`;
    defs.radial(
      key,
      [
        [0, color, 0.75],
        [0.7, color, 0.35],
        [1, color, 0],
      ],
      50,
      50,
      50,
    );
    const cx = 300 + (rng() - 0.5) * 110;
    const cy = 270 + (rng() - 0.5) * 90;
    const rx = 190 + rng() * 60;
    const ry = 170 + rng() * 50;
    out += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${defs.ref(key)}" opacity="${i === 2 ? 0.5 : 0.8}"/>`;
  });
  return out;
}

/** Lazo: banda que recoge los tallos, dos lazadas, nudo y dos colas. */
function ribbon(defs: Defs, x: number, y: number): string {
  defs.radial(
    'ribbon',
    [
      [0, RIBBON[0]],
      [0.6, RIBBON[1]],
      [1, RIBBON[2]],
    ],
    50,
    100,
    120,
  );
  const fill = `fill="${defs.ref('ribbon')}" stroke="#4a3277" stroke-opacity=".45" stroke-width="1"`;
  const loop = 'M0 0C-24-34-72-34-66 0C-62 24-24 18 0 0Z';
  const tail = 'M-2 4C-14 30-28 50-38 82L-22 74L-14 90C-6 62 2 36 4 6Z';
  return (
    `<g transform="translate(${f(x)} ${f(y)})">` +
    `<path d="M-28-4C-9 2 9 2 28-4L28 14C9 20-9 20-28 14Z" ${fill}/>` +
    `<path d="${tail}" ${fill}/><path d="${tail}" transform="scale(-1 1)" ${fill}/>` +
    `<path d="${loop}" ${fill}/><path d="${loop}" transform="scale(-1 1)" ${fill}/>` +
    `<ellipse cy="3" rx="12" ry="10" ${fill}/>` +
    `<path d="M-40-12C-30-18-20-16-12-8M40-12C30-18 20-16 12-8" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.6" stroke-linecap="round"/>` +
    `</g>`
  );
}

function polaroids(defs: Defs, items: readonly PlacedPolaroid[], o: RenderOptions): string {
  if (items.length === 0) return '';
  const p = items[0] as PlacedPolaroid;
  defs.put(
    'pclip',
    `<clipPath id="${defs.id('pclip')}"><rect x="${p.photo.x}" y="${p.photo.y}" width="${p.photo.w}" height="${p.photo.h}"/></clipPath>`,
  );
  let out = '';
  for (const it of items) {
    const { w, h, photo } = it;
    const url = o.images?.[it.id];
    const image =
      url && url.startsWith('blob:')
        ? `<image href="${esc(url)}" x="${photo.x}" y="${photo.y}" width="${photo.w}" height="${photo.h}" preserveAspectRatio="xMidYMid slice" clip-path="${defs.ref('pclip')}"/>`
        : '';
    out +=
      `<g class="mg-pol" data-id="${esc(it.id)}" aria-hidden="true" transform="translate(${f(it.x)} ${f(it.y)}) rotate(${f(it.rot)})">` +
      `<rect x="${f(-w / 2 + 3)}" y="${f(-h / 2 + 4)}" width="${w}" height="${h}" rx="2" fill="#37313f" fill-opacity=".14"/>` +
      `<rect x="${f(-w / 2)}" y="${f(-h / 2)}" width="${w}" height="${h}" rx="2" fill="#fff" stroke="#dcd0f0" stroke-width=".8"/>` +
      `<rect x="${photo.x}" y="${photo.y}" width="${photo.w}" height="${photo.h}" fill="#dcd0f0"/>${image}` +
      `<rect x="-24" y="${f(-h / 2 - 9)}" width="48" height="17" fill="#b8a0d9" fill-opacity=".6" transform="rotate(-4)"/>` +
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
      [0, '#8f6fc7'],
      [0.6, '#c9a8e0'],
      [1, '#f1d9ea'],
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
    inner += `<circle cx="${dx}" cy="${dy}" r="${r}" fill="${defs.ref('bud')}" stroke="#6f4fae" stroke-opacity=".4" stroke-width="1"/>`;
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
