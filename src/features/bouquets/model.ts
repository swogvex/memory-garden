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
  /** Dónde se recoge el tallo, en el lazo. */
  readonly stemX: number;
}

export interface PlacedLeaf {
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly length: number;
  readonly kind: 'lance' | 'broad' | 'strap';
  readonly tone: number;
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
  readonly leaves: readonly PlacedLeaf[];
  readonly base: { readonly x: number; readonly y: number };
  readonly polaroids: readonly PlacedPolaroid[];
  /** Recuerdos que no caben como flor (se agrupan en «+N más»). */
  readonly overflow: { readonly count: number; readonly x: number; readonly y: number } | null;
}
