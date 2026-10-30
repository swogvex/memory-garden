import { addDays, toIso, type CalendarDate, type YearMonth } from './calendar';

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

/** «20 oct 2026». */
export function formatShortDate(date: CalendarDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(date.year, date.month, date.day));
}

/** Orden de las fechas cortas elegido en Configuración (H8.1). Mismos valores que `DATE_FORMATS` de lib/validation. */
export type DateOrder = 'dmy' | 'mdy' | 'ymd';

/**
 * Fecha corta según la preferencia: «20 oct 2026» (dmy), «Oct 20, 2026» (mdy) o «2026-10-20» (ymd).
 * El nombre del mes sale del idioma; el orden, de la preferencia. Sin zona horaria: es una fecha de calendario (D-024).
 */
export function formatCompactDate(date: CalendarDate, locale: string, order: DateOrder): string {
  if (order === 'ymd') return toIso(date);
  const parts = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(utcDate(date.year, date.month, date.day));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const day = part('day');
  const month = part('month');
  const year = part('year');
  return order === 'mdy' ? `${month} ${day}, ${year}` : `${day} ${month} ${year}`;
}

/** Zonas horarias que conoce el navegador (IANA). Si no puede listarlas, al menos la del dispositivo y UTC. */
export function listTimeZones(fallback: string): string[] {
  try {
    const all = (Intl as { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf?.(
      'timeZone',
    );
    if (all && all.length > 0) return all.includes(fallback) ? all : [fallback, ...all];
  } catch {
    // navegador antiguo
  }
  return fallback === 'UTC' ? ['UTC'] : [fallback, 'UTC'];
}

/** ¿El navegador acepta esta zona? (una zona guardada en otro dispositivo podría no existir aquí). */
export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
