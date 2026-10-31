import type { MemoryFields } from '@/features/calendar';
import { parseIso } from '@/lib/dates';
import type { MessageKey } from '@/lib/i18n';
import { parseMemoryPayload, ValidationError } from '@/lib/validation';
import type { CategoryOption, Flower, Season } from './defaults';

export interface FormFields {
  title: string;
  date: string;
  category: string;
  text: string;
  link: string;
  flower: Flower;
  season: Season;
}
/** Clave = campo (`title`, `date`, `category`, `text`, `link`, `photos`) o `alt-<posición>`. */
export type FieldErrors = Record<string, MessageKey | undefined>;
export type Validation =
  | { readonly ok: true; readonly fields: MemoryFields }
  | { readonly ok: false; readonly errors: FieldErrors };

export function seasonOfDate(iso: string): Season | null {
  const d = parseIso(iso);
  if (!d) return null;
  if (d.month >= 3 && d.month <= 5) return 'primavera';
  if (d.month >= 6 && d.month <= 8) return 'verano';
  if (d.month >= 9 && d.month <= 11) return 'otono';
  return 'invierno';
}

export function flowerForCategory(
  categories: readonly CategoryOption[],
  name: string,
  fallback: Flower,
): Flower {
  return categories.find((c) => c.name === name)?.flower ?? fallback;
}

export function initialFields(date: string, categories: readonly CategoryOption[]): FormFields {
  const first = categories[0];
  return {
    title: '',
    date,
    category: first?.name ?? '',
    text: '',
    link: '',
    flower: first?.flower ?? 'rosa',
    season: seasonOfDate(date) ?? 'primavera',
  };
}

export function isDirty(initial: FormFields, now: FormFields, photoCount: number): boolean {
  return (
    photoCount > 0 ||
    now.title !== initial.title ||
    now.date !== initial.date ||
    now.category !== initial.category ||
    now.text !== initial.text ||
    now.link !== initial.link ||
    now.flower !== initial.flower ||
    now.season !== initial.season
  );
}

export function normalizeFields(f: FormFields): MemoryFields {
  const link = f.link.trim();
  return {
    title: f.title.trim(),
    date: f.date,
    category: f.category.trim(),
    text: f.text,
    link: link === '' ? null : link,
    flower: f.flower,
    season: f.season,
  };
}

const PLACEHOLDER_ID = 'A'.repeat(22);
const GENERIC: MessageKey = 'memory.error.field';

function messageFor(head: string, rule: string, fields: MemoryFields): MessageKey {
  switch (head) {
    case 'title':
      if (fields.title === '') return 'memory.error.title.required';
      return rule === 'max_length' ? 'memory.error.title.long' : GENERIC;
    case 'date':
      return 'memory.error.date.invalid';
    case 'category':
      return fields.category === '' ? 'memory.error.category.required' : GENERIC;
    case 'text':
      return rule === 'max_length' ? 'memory.error.text.long' : GENERIC;
    case 'link':
      return 'memory.error.link.invalid';
    default:
      return GENERIC;
  }
}

/** Valida con los esquemas de `lib/validation` (única fuente de verdad); los errores salen asociados a su campo. */
export function validateFields(f: FormFields, alts: readonly string[]): Validation {
  const fields = normalizeFields(f);
  try {
    parseMemoryPayload({
      ...fields,
      photos: alts.map((alt) => ({ assetId: PLACEHOLDER_ID, thumbId: PLACEHOLDER_ID, alt })),
    });
    return { ok: true, fields };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const errors: FieldErrors = {};
    for (const issue of error.issues) {
      const [head = '', index, leaf] = issue.path.split('.');
      if (head === 'photos' && leaf === 'alt') {
        errors[`alt-${index ?? '0'}`] ??=
          issue.rule === 'max_length' ? 'memory.error.alt.long' : GENERIC;
      } else {
        errors[head] ??= messageFor(head, issue.rule, fields);
      }
    }
    return { ok: false, errors };
  }
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list];
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length) return copy;
  const [item] = copy.splice(from, 1);
  if (item !== undefined) copy.splice(to, 0, item);
  return copy;
}
/** La portada es siempre la primera (D-134). */
export const makeCover = <T>(list: readonly T[], index: number): T[] => moveItem(list, index, 0);
export const removeAt = <T>(list: readonly T[], index: number): T[] =>
  list.filter((_, i) => i !== index);
