/** Nivel de detalle: `full` (venas, brillos y motas), `lite` (sin motas) o `icon` (miniaturas). */
export type Detail = 'full' | 'lite' | 'icon';

/** Número a texto con 2 decimales como máximo. Falla ante NaN o infinito. */
export function f(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('svg: número no finito');
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Escapa un valor de atributo o de texto. */
export const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const HEX = /^#[0-9a-fA-F]{6}$/;

function channels(color: string): [number, number, number] {
  if (!HEX.test(color)) throw new RangeError(`svg: color no válido (${color})`);
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
}

/** Mezcla dos colores `#rrggbb`: `t = 0` da `a` y `t = 1` da `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  const out = ca.map((v, i) => {
    const w = cb[i] ?? v;
    return Math.min(255, Math.max(0, Math.round(v + (w - v) * t)))
      .toString(16)
      .padStart(2, '0');
  });
  return `#${out.join('')}`;
}

/** Parada de un degradado: [posición 0–1, color, opacidad opcional]. */
export type Stop = readonly [number, string, number?];

const KEY = /^[A-Za-z0-9_-]+$/;

/**
 * Definiciones reutilizables de un documento SVG (formas, degradados, grupos).
 * Todos los ids llevan un prefijo único por documento para no chocar con otros SVG de la página.
 * Registrar dos veces la misma clave no duplica nada: gana la primera.
 */
export class Defs {
  private readonly items = new Map<string, string>();

  constructor(private readonly prefix: string) {
    if (!KEY.test(prefix)) throw new RangeError('svg: prefijo de ids no válido');
  }

  /** Id completo de una clave. */
  id(key: string): string {
    if (!KEY.test(key)) throw new RangeError(`svg: clave no válida (${key})`);
    return `${this.prefix}${key}`;
  }

  /** `url(#id)` para `fill`, `stroke` o `clip-path`. */
  ref(key: string): string {
    return `url(#${this.id(key)})`;
  }

  /** `#id` para `<use href>`. */
  use(key: string): string {
    return `#${this.id(key)}`;
  }

  /** Marcado ya serializado (debe llevar su propio `id`). Idempotente por clave. */
  put(key: string, markup: string): void {
    if (!this.items.has(key)) this.items.set(key, markup);
  }

  shape(key: string, d: string): void {
    this.put(key, `<path id="${this.id(key)}" d="${esc(d)}"/>`);
  }

  group(key: string, inner: string): void {
    this.put(key, `<g id="${this.id(key)}">${inner}</g>`);
  }

  /** Degradado radial; `cx`, `cy` y `r` en porcentaje (por defecto, desde la base del pétalo). */
  radial(key: string, stops: readonly Stop[], cx = 50, cy = 100, r = 110): void {
    const body = stops
      .map(([offset, color, opacity]) => {
        const extra = opacity === undefined ? '' : ` stop-opacity="${f(opacity)}"`;
        return `<stop offset="${f(offset)}" stop-color="${esc(color)}"${extra}/>`;
      })
      .join('');
    this.put(
      key,
      `<radialGradient id="${this.id(key)}" cx="${f(cx)}%" cy="${f(cy)}%" r="${f(r)}%">${body}</radialGradient>`,
    );
  }

  /** Degradado lineal de (x1, y1) a (x2, y2), en porcentaje de la caja del elemento. */
  linear(key: string, stops: readonly Stop[], x1 = 0, y1 = 0, x2 = 0, y2 = 100): void {
    const body = stops
      .map(([offset, color, opacity]) => {
        const extra = opacity === undefined ? '' : ` stop-opacity="${f(opacity)}"`;
        return `<stop offset="${f(offset)}" stop-color="${esc(color)}"${extra}/>`;
      })
      .join('');
    this.put(
      key,
      `<linearGradient id="${this.id(key)}" x1="${f(x1)}%" y1="${f(y1)}%" x2="${f(x2)}%" y2="${f(y2)}%">${body}</linearGradient>`,
    );
  }

  /** Número de definiciones registradas. */
  get size(): number {
    return this.items.size;
  }

  toString(): string {
    return `<defs>${[...this.items.values()].join('')}</defs>`;
  }
}
