/** Fechas de calendario (D-024): año/mes/día sin hora ni zona. Aritmética pura, sin `Date`. */
export interface CalendarDate {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number;
}
export interface YearMonth {
  readonly year: number;
  readonly month: number;
}
export interface GridCell {
  readonly date: CalendarDate;
  readonly iso: string;
  readonly inMonth: boolean;
}

const GRID_WEEKS = 6;
const WEEK_LENGTH = 7;

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('dates:invalid_month');
  }
  return month === 2 && isLeapYear(year) ? 29 : (DAYS[month - 1] ?? 31);
}

export function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** Días desde 1970-01-01 (algoritmo de días civiles de H. Hinnant). */
export function toEpochDay(date: CalendarDate): number {
  const y = date.month <= 2 ? date.year - 1 : date.year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = date.month > 2 ? date.month - 3 : date.month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + date.day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromEpochDay(epochDay: number): CalendarDate {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** 0 = lunes … 6 = domingo (1970-01-01 fue jueves). */
export function mondayIndex(date: CalendarDate): number {
  return (((toEpochDay(date) + 3) % 7) + 7) % 7;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export function toIso(date: CalendarDate): string {
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/** Estricto: solo AAAA-MM-DD con dígitos ASCII y fecha real. */
export function parseIso(text: string): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return isValidDate(year, month, day) ? { year, month, day } : null;
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function monthOf(date: CalendarDate): YearMonth {
  return { year: date.year, month: date.month };
}

export function addMonths(ym: YearMonth, months: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + months;
  const year = Math.floor(index / 12);
  return { year, month: index - year * 12 + 1 };
}

/** `AAAA-MM`, clave de agrupación por mes. */
export function ymKey(ym: YearMonth): string {
  return `${pad(ym.year, 4)}-${pad(ym.month, 2)}`;
}

/** Cuadrícula de 6 semanas (lunes primero) con relleno de los meses adyacentes. */
export function monthGrid(ym: YearMonth): GridCell[][] {
  const first: CalendarDate = { year: ym.year, month: ym.month, day: 1 };
  const start = toEpochDay(first) - mondayIndex(first);
  const weeks: GridCell[][] = [];
  for (let w = 0; w < GRID_WEEKS; w++) {
    const week: GridCell[] = [];
    for (let d = 0; d < WEEK_LENGTH; d++) {
      const date = fromEpochDay(start + w * WEEK_LENGTH + d);
      week.push({
        date,
        iso: toIso(date),
        inMonth: date.year === ym.year && date.month === ym.month,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function partsIn(timeZone: string, now: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** «Hoy» como fecha de calendario en una zona (por defecto la del dispositivo). Zona inválida: la del dispositivo. */
export function todayIn(timeZone: string = deviceTimeZone(), now: Date = new Date()): CalendarDate {
  try {
    return partsIn(timeZone, now);
  } catch (error) {
    if (error instanceof RangeError && timeZone !== deviceTimeZone()) {
      return partsIn(deviceTimeZone(), now);
    }
    throw error;
  }
}
