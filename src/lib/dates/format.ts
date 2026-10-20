import { addDays, type CalendarDate, type YearMonth } from './calendar';

/** Fecha UTC a medianoche (válida también para años < 100). */
function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

export function formatMonthYear(ym: YearMonth, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(ym.year, ym.month, 1));
}

/** Fecha completa para nombres accesibles: «martes, 20 de octubre de 2026». */
export function formatLongDate(date: CalendarDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(date.year, date.month, date.day));
}

export function monthShortLabels(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => fmt.format(utcDate(2024, i + 1, 1)));
}

/** Lunes primero. */
export function weekdayLabels(locale: string): { short: string; long: string }[] {
  const short = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const long = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  const monday: CalendarDate = { year: 2024, month: 1, day: 1 };
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    const u = utcDate(d.year, d.month, d.day);
    return { short: short.format(u), long: long.format(u) };
  });
}
