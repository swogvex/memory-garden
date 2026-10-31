import {
  array,
  check,
  literal,
  maxLength,
  minLength,
  nullable,
  picklist,
  pipe,
  regex,
  safeParse,
  strictObject,
  string,
  union,
} from 'valibot';
import type { GenericSchema, InferOutput } from 'valibot';
import { isCleanText, isCalendarDate, isHttpUrl, isNotBlank } from './checks';
import {
  DATE_FORMATS,
  FLOWERS,
  LANGUAGES,
  LIMITS,
  MAX_CATEGORIES,
  MAX_PHOTOS,
  SEASONS,
} from './limits';

export { DATE_FORMATS, FLOWERS, LIMITS, MAX_CATEGORIES, MAX_PHOTOS, SEASONS } from './limits';

const id = pipe(string(), regex(/^[A-Za-z0-9_-]{22}$/));
/** Una línea, no vacía, sin controles. */
const line = (max: number) =>
  pipe(
    string(),
    minLength(1),
    maxLength(max),
    check(isNotBlank),
    check((s) => isCleanText(s)),
  );
/** Texto largo (admite saltos de línea y tabulaciones), sin otros controles. */
const longText = (max: number) =>
  pipe(
    string(),
    maxLength(max),
    check((s) => isCleanText(s, true)),
  );

const photoRef = strictObject({
  assetId: id,
  thumbId: id,
  alt: pipe(
    string(),
    maxLength(LIMITS.alt),
    check((s) => isCleanText(s)),
  ),
});

/** Contenido de un recuerdo tal y como se cifra (CONTEXTO §5). Todos los campos son obligatorios (`null` si no hay enlace). */
const MemoryPayloadSchema = strictObject({
  title: line(LIMITS.title),
  date: pipe(
    string(),
    check((s) => isCalendarDate(s)),
  ),
  category: line(LIMITS.category),
  text: longText(LIMITS.text),
  link: nullable(
    pipe(
      string(),
      check((s) => isHttpUrl(s)),
    ),
  ),
  flower: picklist(FLOWERS),
  season: picklist(SEASONS),
  photos: pipe(array(photoRef), maxLength(MAX_PHOTOS)),
});
export type MemoryPayload = InferOutput<typeof MemoryPayloadSchema>;

/** Ajustes cifrados del espacio. */
const SettingsSchema = strictObject({
  displayName: pipe(
    string(),
    maxLength(LIMITS.displayName),
    check((s) => isCleanText(s)),
  ),
  welcomeMessage: longText(LIMITS.welcome),
  language: picklist(LANGUAGES),
  dateFormat: picklist(DATE_FORMATS),
  timeZone: nullable(pipe(string(), regex(/^[A-Za-z0-9_+\-/]{1,64}$/))),
  avatar: nullable(
    union([
      strictObject({ kind: literal('preset'), id: picklist(FLOWERS) }),
      strictObject({ kind: literal('asset'), assetId: id }),
    ]),
  ),
  categories: pipe(
    array(strictObject({ name: line(LIMITS.category), flower: picklist(FLOWERS) })),
    maxLength(MAX_CATEGORIES),
  ),
});
export type Settings = InferOutput<typeof SettingsSchema>;

export interface SafeIssue {
  /** Ruta del campo, p. ej. `photos.2.alt`. Nunca contiene valores del usuario. */
  readonly path: string;
  /** Regla incumplida (`min_length`, `max_length`, `check`, `picklist`, …). */
  readonly rule: string;
}

/**
 * Error de validación SIN valores del usuario: Valibot incluye `input` y `received` en sus incidencias,
 * así que se descartan aquí; solo salen la ruta y la regla (la interfaz decide el mensaje).
 */
export class ValidationError extends Error {
  readonly issues: readonly SafeIssue[];
  constructor(issues: readonly SafeIssue[]) {
    super('validation:invalid');
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

function run<T>(schema: GenericSchema, input: unknown): T {
  const r = safeParse(schema, input);
  if (r.success) return r.output as T;
  throw new ValidationError(
    r.issues.map((i) => ({
      path: (i.path ?? []).map((p) => String(p.key)).join('.'),
      rule: i.type,
    })),
  );
}

export const parseMemoryPayload = (input: unknown): MemoryPayload =>
  run<MemoryPayload>(MemoryPayloadSchema, input);
export const parseSettings = (input: unknown): Settings => run<Settings>(SettingsSchema, input);
