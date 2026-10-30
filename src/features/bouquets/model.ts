import type { FlowerId } from '@/lib/flowers';

/** Lo único que el ramo necesita saber de un recuerdo (modelo de vista; sin datos sensibles de más). */
export interface BouquetMemory {
  readonly id: string;
  /** Fecha del recuerdo, `AAAA-MM-DD`. */
  readonly date: string;
  readonly flower: FlowerId;
  /** Tiene al menos una foto (para poder prender una Polaroid). */
  readonly hasPhoto: boolean;
}

export interface BouquetInput {
  /** Mes del ramo, `AAAA-MM`. */
  readonly month: string;
  readonly memories: readonly BouquetMemory[];
}

/**
 * Tallo: curva cúbica desde la cabeza (x0, y0) hasta el lazo (x1, y1) y recta desde el lazo hasta
 * el corte (ex, ey). Todos los tallos pasan por el lazo: así el ramo «se recoge» de verdad.
 */
export interface StemCurve {
  readonly x0: number;
  readonly y0: number;
  readonly c1x: number;
  readonly c1y: number;
  readonly c2x: number;
  readonly c2y: number;
  readonly x1: number;
  readonly y1: number;
  readonly ex: number;
  readonly ey: number;
  readonly width: number;
  /** Variante de verde (0–2). */
  readonly tone: number;
}

export interface PlacedFlower {
  readonly id: string;
  readonly flower: FlowerId;
  readonly date: string;
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly scale: number;
  /** Radio visual en el lienzo. */
  readonly radius: number;
  readonly tone: number;
  /** Semilla con la que se dibuja esta flor (mes + id): no depende de las demás. */
  readonly seed: string;
  /** Dónde se recoge el tallo, en el lazo (igual a `stem.x1`). */
  readonly stemX: number;
  readonly stem: StemCurve;
}

/** Relleno decorativo: no es un recuerdo, no es interactivo y no se anuncia a lectores de pantalla. */
export type FillerKind = 'sprig' | 'gyps' | 'greens' | 'bud';

export interface PlacedFiller {
  readonly kind: FillerKind;
  /** Punto donde termina el tallo y empieza el adorno. */
  readonly x: number;
  readonly y: number;
  /** Giro (grados; 0 = hacia arriba). */
  readonly rot: number;
  /** Largo del adorno en unidades del lienzo. */
  readonly length: number;
  readonly tone: number;
  readonly seed: string;
  readonly stem: StemCurve;
}

/** Hoja pegada a un tallo: su base está sobre la curva del tallo `owner` en el parámetro `t`. */
export interface PlacedLeaf {
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly length: number;
  readonly kind: 'lance' | 'broad' | 'strap';
  readonly tone: number;
  readonly owner: { readonly kind: 'flower' | 'filler'; readonly index: number };
  readonly t: number;
}

export interface PlacedPolaroid {
  readonly id: string;
  readonly flower: FlowerId;
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly w: number;
  readonly h: number;
  /** Hueco de la foto, relativo al centro de la Polaroid. */
  readonly photo: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
  /** Color de la cinta (0–2). */
  readonly tape: number;
}

export interface BouquetLayout {
  readonly month: string;
  /** Semilla (hash de mes + ids ordenados), en hexadecimal. */
  readonly seed: string;
  readonly width: number;
  readonly height: number;
  /** Total de recuerdos del mes (visibles o no). */
  readonly total: number;
  /** En orden de dibujo: las del fondo primero. */
  readonly flowers: readonly PlacedFlower[];
  readonly filler: readonly PlacedFiller[];
  readonly leaves: readonly PlacedLeaf[];
  /** Centro del lazo (por donde pasan todos los tallos). */
  readonly base: { readonly x: number; readonly y: number };
  /** Tamaño del lazo (1 = ramo pequeño); crece con la copa. */
  readonly bowScale: number;
  /** Centro y semiejes de la copa del ramo (para el fondo de acuarela y la textura). */
  readonly dome: {
    readonly x: number;
    readonly y: number;
    readonly rx: number;
    readonly ry: number;
  };
  readonly polaroids: readonly PlacedPolaroid[];
  /** Recuerdos que no caben como flor (se agrupan en «+N más»). */
  readonly overflow: { readonly count: number; readonly x: number; readonly y: number } | null;
}
