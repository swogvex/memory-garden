import type { Rng } from '../rng';
import { between, jitter } from '../rng';
import { Defs, f, mix, type Detail } from '../svg';

export type LeafKind = 'lance' | 'broad' | 'strap';

export interface DrawOptions {
  readonly rng: Rng;
  readonly defs: Defs;
  readonly detail: Detail;
  /** Variante de color: 0, 1 o 2. */
  readonly tone: number;
}

/** Cabeza de una flor, centrada en (0, 0) y mirando hacia arriba. */
export interface Head {
  readonly body: string;
  /** Radio del círculo que la contiene (para evitar solapes). */
  readonly radius: number;
  /** Punto donde nace el tallo, respecto al centro. */
  readonly attach: { readonly x: number; readonly y: number };
  readonly leaf: LeafKind;
}

export type HeadDrawer = (o: DrawOptions) => Head;

/** Paleta de una variante: oscuro (base del pétalo), medio, claro (borde) y color del contorno. */
export interface Palette {
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
  readonly edge: string;
}

export const WHITE = '#ffffff';

/** Degradado de la capa `layer` (0 = exterior): cada capa interior es algo más clara. */
export function layerGradient(o: DrawOptions, flower: string, p: Palette, layer: number): string {
  const k = layer * 0.14;
  const key = `${flower}-${o.tone}-${layer}`;
  o.defs.radial(key, [
    [0, mix(p.dark, p.mid, k)],
    [0.55, mix(p.mid, p.light, k)],
    [1, mix(p.light, WHITE, k)],
  ]);
  return o.defs.ref(key);
}

export interface RingSpec {
  /** Clave de la forma en las definiciones. */
  readonly shape: string;
  readonly n: number;
  readonly offset: number;
  readonly scale: number;
  readonly fill: string;
  readonly edge: string;
  readonly edgeOpacity?: number;
  readonly edgeWidth?: number;
  /** Variación del ángulo (grados) y de la escala (fracción). */
  readonly angleJitter?: number;
  readonly scaleJitter?: number;
  /** Trazos interiores (nervaduras) y brillo, en coordenadas del pétalo; solo en `full`. */
  readonly veins?: string;
  readonly shine?: string;
  readonly veinColor?: string;
  readonly cx?: number;
  readonly cy?: number;
}

/** Anillo de pétalos repartidos alrededor de un centro. */
export function ring(o: DrawOptions, s: RingSpec): string {
  const { rng, detail, defs } = o;
  const full = detail === 'full';
  let out = '';
  for (let i = 0; i < s.n; i++) {
    const a = s.offset + (360 / s.n) * i + jitter(rng, (s.angleJitter ?? 14) / 2);
    const k = s.scale * (1 + jitter(rng, (s.scaleJitter ?? 0.12) / 2));
    const w = (s.edgeWidth ?? 1.3) / k;
    let inner = `<use href="${defs.use(s.shape)}" fill="${s.fill}" stroke="${s.edge}" stroke-opacity="${f(s.edgeOpacity ?? 0.5)}" stroke-width="${f(w)}"/>`;
    if (full && s.veins) {
      inner += `<path d="${s.veins}" fill="none" stroke="${s.veinColor ?? s.edge}" stroke-opacity=".16" stroke-width="${f(0.7 / k)}" stroke-linecap="round"/>`;
    }
    if (full && s.shine) {
      inner += `<path d="${s.shine}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="${f(1.8 / k)}" stroke-linecap="round"/>`;
    }
    out += `<g transform="translate(${f(s.cx ?? 0)} ${f(s.cy ?? 0)}) rotate(${f(a)}) scale(${f(k)})">${inner}</g>`;
  }
  return out;
}

/** Sombra circular suave entre capas: da profundidad a la copa. */
export function shadeCircle(
  o: DrawOptions,
  flower: string,
  r: number,
  color: string,
  opacity: number,
  cy = 0,
): string {
  if (o.detail === 'icon') return '';
  const key = `${flower}-shade`;
  o.defs.radial(
    key,
    [
      [0.55, color, 0],
      [1, color, opacity],
    ],
    50,
    50,
    50,
  );
  return `<circle cx="0" cy="${f(cy)}" r="${f(r)}" fill="${o.defs.ref(key)}"/>`;
}

/** Motas de pigmento (granulación). Solo con detalle completo. */
export function speckles(
  o: DrawOptions,
  count: number,
  radius: number,
  color: string,
  cy = 0,
): string {
  if (o.detail !== 'full') return '';
  let out = '';
  for (let i = 0; i < count; i++) {
    const a = o.rng() * Math.PI * 2;
    const d = Math.sqrt(o.rng()) * radius;
    const r = between(o.rng, 0.3, 0.8);
    out += `<circle cx="${f(Math.cos(a) * d)}" cy="${f(cy + Math.sin(a) * d)}" r="${f(r)}" fill="${color}" fill-opacity="${f(between(o.rng, 0.2, 0.4))}"/>`;
  }
  return out;
}

/** Sépalos verdes bajo la flor, justo donde nace el tallo. */
export function sepals(o: DrawOptions, y: number, count = 5, spread = 26): string {
  if (o.detail === 'icon') return '';
  o.defs.shape('sepal', 'M0 0C-3 6-3 14 0 22C3 14 3 6 0 0Z');
  let out = '';
  const start = (-(count - 1) / 2) * spread;
  for (let i = 0; i < count; i++) {
    const a = start + i * spread + jitter(o.rng, 4);
    out += `<use href="${o.defs.use('sepal')}" transform="translate(0 ${f(y)}) rotate(${f(a)})" fill="#5d7a55" stroke="#2f4a2e" stroke-opacity=".3" stroke-width=".5"/>`;
  }
  return out;
}
