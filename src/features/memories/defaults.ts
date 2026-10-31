import type { MessageKey } from '@/lib/i18n';
import type { MemoryPayload } from '@/lib/validation';

export type Flower = MemoryPayload['flower'];
export type Season = MemoryPayload['season'];
export interface CategoryOption {
  readonly name: string;
  readonly flower: Flower;
}

/**
 * Categorías de serie (D-135). Las pantallas usan las de los ajustes cifrados (`prefs.settings.categories`,
 * creadas con `defaultCategories` de lib/settings); esta constante queda para las pruebas del formulario.
 */
export const DEFAULT_CATEGORIES: readonly CategoryOption[] = [
  { name: 'Viajes', flower: 'girasol' },
  { name: 'Momentos', flower: 'camelia' },
  { name: 'Naturaleza', flower: 'lavanda' },
  { name: 'Citas', flower: 'rosa' },
];

export const FLOWER_LABEL = {
  lavanda: 'flower.lavanda',
  hortensia: 'flower.hortensia',
  margarita: 'flower.margarita',
  rosa: 'flower.rosa',
  tulipan: 'flower.tulipan',
  girasol: 'flower.girasol',
  dalia: 'flower.dalia',
  camelia: 'flower.camelia',
} as const satisfies Record<Flower, MessageKey>;

export const SEASON_LABEL = {
  primavera: 'season.primavera',
  verano: 'season.verano',
  otono: 'season.otono',
  invierno: 'season.invierno',
} as const satisfies Record<Season, MessageKey>;
