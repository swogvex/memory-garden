/**
 * Catálogo de las 8 flores propias (DISENO.md §6). Los textos (nombre, significado y texto
 * alternativo) viven en los diccionarios de i18n bajo `catalog.flower.<id>.<campo>`.
 */
export const FLOWER_IDS = [
  'lavanda',
  'hortensia',
  'margarita',
  'rosa',
  'tulipan',
  'girasol',
  'dalia',
  'camelia',
] as const;

export type FlowerId = (typeof FLOWER_IDS)[number];
/** Mismos identificadores que `SEASONS` de `lib/validation` (una prueba lo comprueba). */
export type FlowerSeason = 'primavera' | 'verano' | 'otono' | 'invierno';
export type FlowerField = 'name' | 'meaning' | 'alt';
export type FlowerKey = `catalog.flower.${FlowerId}.${FlowerField}`;

/** Papel de la flor en la composición: las grandes al centro, las espigas en el borde. */
export type FlowerRole = 'focal' | 'mid' | 'spike';
export type LeafShape = 'lance' | 'broad' | 'strap';

export interface FlowerInfo {
  readonly id: FlowerId;
  /** Estaciones en las que se sugiere (DISENO §6; la usuaria puede cambiarla). */
  readonly seasons: readonly FlowerSeason[];
  readonly role: FlowerRole;
  /** Tamaño relativo de la cabeza dentro de un ramo. */
  readonly size: number;
  /** Radio de la cabeza en unidades de dibujo (el que devuelve su `Head`). */
  readonly radius: number;
  readonly leaf: LeafShape;
  /** Grosor relativo del tallo. */
  readonly stem: number;
}

export const FLOWER_INFO: Readonly<Record<FlowerId, FlowerInfo>> = {
  lavanda: {
    id: 'lavanda',
    seasons: ['verano'],
    role: 'spike',
    size: 1.1,
    radius: 36,
    leaf: 'strap',
    stem: 0.8,
  },
  hortensia: {
    id: 'hortensia',
    seasons: ['verano'],
    role: 'focal',
    size: 1.05,
    radius: 40,
    leaf: 'broad',
    stem: 1.1,
  },
  margarita: {
    id: 'margarita',
    seasons: ['primavera'],
    role: 'mid',
    size: 0.95,
    radius: 42,
    leaf: 'lance',
    stem: 0.8,
  },
  rosa: {
    id: 'rosa',
    seasons: ['otono', 'invierno'],
    role: 'focal',
    size: 1,
    radius: 38,
    leaf: 'lance',
    stem: 1,
  },
  tulipan: {
    id: 'tulipan',
    seasons: ['primavera'],
    role: 'mid',
    size: 1,
    radius: 36,
    leaf: 'strap',
    stem: 1,
  },
  girasol: {
    id: 'girasol',
    seasons: ['verano'],
    role: 'focal',
    size: 1.05,
    radius: 48,
    leaf: 'broad',
    stem: 1.4,
  },
  dalia: {
    id: 'dalia',
    seasons: ['otono'],
    role: 'focal',
    size: 1.05,
    radius: 40,
    leaf: 'lance',
    stem: 1.1,
  },
  camelia: {
    id: 'camelia',
    seasons: ['invierno'],
    role: 'mid',
    size: 1,
    radius: 37,
    leaf: 'lance',
    stem: 1,
  },
};

export function isFlowerId(value: string): value is FlowerId {
  return (FLOWER_IDS as readonly string[]).includes(value);
}

/** Clave de i18n de un campo de texto de la flor. */
export const flowerKey = (id: FlowerId, field: FlowerField): FlowerKey =>
  `catalog.flower.${id}.${field}`;

export function flowersForSeason(season: FlowerSeason): FlowerId[] {
  return FLOWER_IDS.filter((id) => FLOWER_INFO[id].seasons.includes(season));
}
