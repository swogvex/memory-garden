import type { MemoryPayload } from '@/lib/validation';

type Category = 'Viajes' | 'Momentos' | 'Naturaleza' | 'Citas';
const FLOWER_OF: Record<Category, MemoryPayload['flower']> = {
  Viajes: 'girasol',
  Momentos: 'rosa',
  Naturaleza: 'margarita',
  Citas: 'camelia',
};
const CATEGORIES: readonly Category[] = ['Viajes', 'Momentos', 'Naturaleza', 'Citas'];

function seasonOf(month: number): MemoryPayload['season'] {
  if (month >= 3 && month <= 5) return 'primavera';
  if (month >= 6 && month <= 8) return 'verano';
  if (month >= 9 && month <= 11) return 'otono';
  return 'invierno';
}

/** Recuentos esperados por mes (meses ausentes = 0). Los usan las pruebas unitarias y e2e. */
export const SEED_EXPECTED_COUNTS: Readonly<Record<string, number>> = {
  '2025-12': 1,
  '2026-01': 1,
  '2026-02': 1,
  '2026-03': 0,
  '2026-04': 1,
  '2026-05': 31,
  '2026-06': 1,
  '2026-07': 4,
  '2026-08': 0,
  '2026-09': 0,
  '2026-10': 17,
  '2026-11': 1,
  '2026-12': 1,
  '2027-01': 1,
  '2027-02': 1,
  '2028-02': 1,
  '2028-03': 1,
};
export const SEED_TOTAL = 63;
/** Título con marcado: debe mostrarse como texto. */
export const SEED_MARKUP_TITLE = 'Recuerdo de prueba con <script>alert(1)</script>';

type Entry = readonly [date: string, title: string, category: Category, photos: number];

const OCTOBER: readonly Entry[] = [
  ['2026-10-01', 'Primer día de octubre', 'Momentos', 1],
  ['2026-10-03', 'Paseo por el parque', 'Naturaleza', 2],
  ['2026-10-05', 'Cena en casa', 'Citas', 0],
  [
    '2026-10-08',
    'Un título muy largo para comprobar que el texto se ajusta en pantallas estrechas sin desbordar',
    'Momentos',
    1,
  ],
  ['2026-10-12', 'Desayuno', 'Momentos', 0],
  ['2026-10-12', 'Museo', 'Citas', 3],
  ['2026-10-12', 'Atardecer en la playa', 'Naturaleza', 5],
  ['2026-10-14', 'Viaje a la sierra', 'Viajes', 4],
  ['2026-10-14', 'Vuelta a casa', 'Viajes', 1],
  ['2026-10-17', 'Superlargapalabrasinespaciosparaprobarelajustedelineas', 'Momentos', 0],
  ['2026-10-19', SEED_MARKUP_TITLE, 'Momentos', 1],
  ['2026-10-20', 'Hoy: comida con amigos', 'Momentos', 2],
  ['2026-10-20', 'Película bajo la manta', 'Citas', 0],
  ['2026-10-22', 'Mercado de otoño', 'Naturaleza', 1],
  ['2026-10-25', 'Cambio de hora', 'Momentos', 0],
  ['2026-10-28', 'Castañas', 'Naturaleza', 2],
  ['2026-10-31', 'Halloween', 'Momentos', 1],
];

const OTHERS: readonly Entry[] = [
  // Frontera de año
  ['2025-12-31', 'Nochevieja', 'Momentos', 2],
  ['2026-01-01', 'Año nuevo', 'Momentos', 1],
  ['2026-02-14', 'San Valentín', 'Citas', 1],
  ['2026-04-23', 'Día del libro', 'Momentos', 0],
  ['2026-06-21', 'Inicio del verano', 'Naturaleza', 1],
  // Varios en un mismo día
  ['2026-07-18', 'Mañana de playa', 'Naturaleza', 1],
  ['2026-07-18', 'Comida junto al mar', 'Citas', 0],
  ['2026-07-18', 'Paseo al anochecer', 'Momentos', 3],
  ['2026-07-18', 'Estrellas', 'Naturaleza', 5],
  ['2026-11-01', 'Día de Todos los Santos', 'Momentos', 0],
  // Segunda frontera de año (futura)
  ['2026-12-31', 'Último día del año', 'Momentos', 1],
  ['2027-01-01', 'Primer día de 2027', 'Momentos', 1],
  // Bisiestos
  ['2027-02-28', 'Fin de febrero', 'Momentos', 0],
  ['2028-02-29', 'Día extra del año bisiesto', 'Momentos', 1],
  ['2028-03-01', 'Primero de marzo', 'Momentos', 0],
];

/** Determinista: mismas entradas, mismo resultado. Sin azar. */
export function buildSeedPayloads(): MemoryPayload[] {
  let counter = 0;
  const id22 = (prefix: string) => `${prefix}${String(counter++).padStart(21, '0')}`;

  // Mayo de 2026: un recuerdo cada día (mes denso)
  const may: Entry[] = Array.from({ length: 31 }, (_, i): Entry => {
    const day = i + 1;
    return [
      `2026-05-${String(day).padStart(2, '0')}`,
      `Recuerdo de mayo ${day}`,
      CATEGORIES[i % CATEGORIES.length] ?? 'Momentos',
      day % 6,
    ];
  });

  return [...OTHERS, ...may, ...OCTOBER].map(([date, title, category, photos]) => ({
    title,
    date,
    category,
    text: `Texto de prueba de «${title}».`,
    link: null,
    flower: FLOWER_OF[category],
    season: seasonOf(Number(date.slice(5, 7))),
    photos: Array.from({ length: photos }, () => ({
      assetId: id22('f'),
      thumbId: id22('t'),
      alt: 'Foto de prueba',
    })),
  }));
}
