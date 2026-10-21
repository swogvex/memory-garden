import { addDays, addMonths, daysInMonth, mondayIndex, type CalendarDate } from '@/lib/dates';

function shiftMonths(date: CalendarDate, months: number): CalendarDate {
  const ym = addMonths({ year: date.year, month: date.month }, months);
  return {
    year: ym.year,
    month: ym.month,
    day: Math.min(date.day, daysInMonth(ym.year, ym.month)),
  };
}

/**
 * Patrón de cuadrícula de fechas de WAI-ARIA: la tecla da la nueva fecha con foco, o `null` si no es
 * una tecla de navegación. Puede cambiar de mes (el llamador lo gestiona).
 */
export function nextFocusDate(date: CalendarDate, key: string, shift = false): CalendarDate | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(date, -1);
    case 'ArrowRight':
      return addDays(date, 1);
    case 'ArrowUp':
      return addDays(date, -7);
    case 'ArrowDown':
      return addDays(date, 7);
    case 'Home':
      return addDays(date, -mondayIndex(date));
    case 'End':
      return addDays(date, 6 - mondayIndex(date));
    case 'PageUp':
      return shiftMonths(date, shift ? -12 : -1);
    case 'PageDown':
      return shiftMonths(date, shift ? 12 : 1);
    default:
      return null;
  }
}
