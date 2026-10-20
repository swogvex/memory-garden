import { monthOf, todayIn, type YearMonth } from '@/lib/dates';

/** Estado compartido entre cabecera y vistas. El mes visible arranca en «hoy» según la zona del dispositivo. */
export const viewState: { month: YearMonth } = $state({ month: monthOf(todayIn()) });
