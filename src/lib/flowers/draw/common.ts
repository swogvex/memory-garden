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
interface Head {
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

/** Estilo de un pétalo reutilizable: se define una vez como grupo y se repite con `<use>`. */
export interface PetalStyle {
  /** Clave de la forma (ya registrada con `defs.shape`). */
  readonly shape: string;
  readonly fill: string;
  readonly edge: string;
  readonly edgeOpacity?: number;
  readonly edgeWidth?: number;
  /** Media hoja en sombra (pliegue central), en coordenadas del pétalo. */
  readonly fold?: string;
  readonly foldColor?: string;
  readonly foldOpacity?: number;
  /** Nervio o surco central; solo con detalle completo. */
  readonly vein?: string;
  readonly veinColor?: string;
  /** Brillo en el borde (luz desde arriba a la izquierda); no en miniatura. */
  readonly shine?: string;
  readonly shineOpacity?: number;
}

/**
 * Registra un pétalo como grupo (`key` ya incluye flor, tono y capa) y devuelve su clave.
 * Repetirlo con `<use>` pesa muy poco: es lo que permite dibujar flores con muchos pétalos.
 */
export function petalDef(o: DrawOptions, key: string, s: PetalStyle): string {
  // En miniatura el contorno es más marcado: a 20 px, una flor blanca sobre papel no se vería.
  const icon = o.detail === 'icon';
  const opacity = icon ? Math.max(0.75, s.edgeOpacity ?? 0.45) : (s.edgeOpacity ?? 0.45);
  const width = (s.edgeWidth ?? 0.9) * (icon ? 1.9 : 1);
  let inner = `<use href="${o.defs.use(s.shape)}" fill="${s.fill}" stroke="${s.edge}" stroke-opacity="${f(opacity)}" stroke-width="${f(width)}" stroke-linejoin="round"/>`;
  if (s.fold && o.detail !== 'icon') {
    inner += `<path d="${s.fold}" fill="${s.foldColor ?? s.edge}" fill-opacity="${f(s.foldOpacity ?? 0.16)}"/>`;
  }
  if (s.vein && o.detail === 'full') {
    inner += `<path d="${s.vein}" fill="none" stroke="${s.veinColor ?? s.edge}" stroke-opacity=".22" stroke-width=".7" stroke-linecap="round"/>`;
  }
  if (s.shine && o.detail !== 'icon') {
    inner += `<path d="${s.shine}" fill="none" stroke="#fff" stroke-opacity="${f(s.shineOpacity ?? 0.6)}" stroke-width="1.4" stroke-linecap="round"/>`;
  }
  o.defs.group(key, inner);
  return key;
}

/** Anillo regular de `n` pétalos ya definidos, con muy poca variación (flores ordenadas, no caóticas). */
export function petalRing(
  o: DrawOptions,
  key: string,
  n: number,
  offset: number,
  scale: number,
  wobble = 3,
  cx = 0,
  cy = 0,
): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = offset + (360 / n) * i + jitter(o.rng, wobble);
    const k = scale * (1 + jitter(o.rng, 0.035));
    out += `<use href="${o.defs.use(key)}" transform="translate(${f(cx)} ${f(cy)}) rotate(${f(a)}) scale(${f(k)})"/>`;
  }
  return out;
}

/** Degradado de un pétalo: de la base (`base`) a la punta (`tip`), con un tono medio. */
export function petalGradient(
  o: DrawOptions,
  key: string,
  base: string,
  middle: string,
  tip: string,
): string {
  o.defs.radial(key, [
    [0, base],
    [0.5, middle],
    [1, tip],
  ]);
  return o.defs.ref(key);
}

/** Papel cálido hacia el que se suavizan los colores (pastel acuarela, D-204). */
const PAPER = '#fbf8f2';

/** Un color suavizado hacia el papel: `t = 0` lo deja igual; `t = 1` lo convierte en papel. */
export const soft = (color: string, t: number): string => mix(color, PAPER, t);

/**
 * Paleta pastel: cada flor conserva su tono (rosa sigue siendo rosa, girasol amarillo) pero con
 * menos saturación. Los oscuros se aclaran más que los claros para reducir el contraste interno,
 * como en una acuarela; el contorno se aclara menos para que la forma siga leyéndose en miniatura.
 */
function pastel(p: Palette): Palette {
  return {
    dark: soft(p.dark, 0.3),
    mid: soft(p.mid, 0.22),
    light: soft(p.light, 0.1),
    edge: soft(p.edge, 0.18),
  };
}

export function pastelSet(
  set: readonly [Palette, Palette, Palette],
): readonly [Palette, Palette, Palette] {
  return [pastel(set[0]), pastel(set[1]), pastel(set[2])];
}
