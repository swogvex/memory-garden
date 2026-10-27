import { monthOf, todayIn, type YearMonth } from '@/lib/dates';

/**
 * Estado compartido entre cabecera y vistas. El mes visible arranca en «hoy» según la zona del dispositivo.
 * `bouquetMonth` (`AAAA-MM`): el Jardín lo fija al pulsar «Ver el ramo» y Ramos lo consume al abrirse.
 */
export const viewState: { month: YearMonth; bouquetMonth: string | null } = $state({
  month: monthOf(todayIn()),
  bouquetMonth: null,
});
