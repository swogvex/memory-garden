import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '@/features/memories/defaults';
import {
  flowerForCategory,
  initialFields,
  isDirty,
  makeCover,
  moveItem,
  normalizeFields,
  removeAt,
  seasonOfDate,
  validateFields,
  type FormFields,
} from '@/features/memories/form-model';

const base = (): FormFields => ({
  title: 'Un día',
  date: '2026-10-06',
  category: 'Viajes',
  text: '',
  link: '',
  flower: 'girasol',
  season: 'otono',
});

describe('validateFields', () => {
  it('acepta un recuerdo correcto y normaliza (título recortado, enlace vacío = null)', () => {
    const r = validateFields({ ...base(), title: '  Hola  ' }, []);
    expect(r.ok && r.fields.title).toBe('Hola');
    expect(r.ok && r.fields.link).toBeNull();
    expect(normalizeFields({ ...base(), link: '  https://e.com/a  ' }).link).toBe(
      'https://e.com/a',
    );
  });
  it('un título con marcado es válido: se mostrará como texto', () => {
    expect(validateFields({ ...base(), title: '<script>alert(1)</script>' }, []).ok).toBe(true);
  });
  it('título vacío, en blanco y demasiado largo', () => {
    for (const title of ['', '   ']) {
      const r = validateFields({ ...base(), title }, []);
      expect(!r.ok && r.errors.title).toBe('memory.error.title.required');
    }
    const long = validateFields({ ...base(), title: 'x'.repeat(121) }, []);
    expect(!long.ok && long.errors.title).toBe('memory.error.title.long');
  });
  it('fecha inválida', () => {
    for (const date of ['', '2026-02-30', 'hoy']) {
      const r = validateFields({ ...base(), date }, []);
      expect(!r.ok && r.errors.date).toBe('memory.error.date.invalid');
    }
  });
  it('enlaces no permitidos', () => {
    for (const link of [
      'javascript:alert(1)',
      'ftp://x.com',
      '//x.com',
      'https://u:p@x.com',
      'ejemplo.com',
    ]) {
      const r = validateFields({ ...base(), link }, []);
      expect(!r.ok && r.errors.link).toBe('memory.error.link.invalid');
    }
  });
  it('texto largo, categoría vacía y texto alternativo largo (con su posición)', () => {
    const t1 = validateFields({ ...base(), text: 'x'.repeat(5001) }, []);
    expect(!t1.ok && t1.errors.text).toBe('memory.error.text.long');
    const c = validateFields({ ...base(), category: '' }, []);
    expect(!c.ok && c.errors.category).toBe('memory.error.category.required');
    const a = validateFields(base(), ['ok', 'x'.repeat(201)]);
    expect(!a.ok && a.errors['alt-1']).toBe('memory.error.alt.long');
    expect(!a.ok && a.errors['alt-0']).toBeUndefined();
  });
  it('más de 5 fotos no pasa', () => {
    const r = validateFields(base(), ['', '', '', '', '', '']);
    expect(r.ok).toBe(false);
  });
  it('los errores no contienen lo escrito', () => {
    const r = validateFields({ ...base(), title: '', text: 'secreto-personal'.repeat(400) }, []);
    expect(JSON.stringify(r)).not.toContain('secreto-personal');
  });
});

describe('temporada, flor y estado', () => {
  it('seasonOfDate', () => {
    expect(seasonOfDate('2026-12-31')).toBe('invierno');
    expect(seasonOfDate('2026-03-01')).toBe('primavera');
    expect(seasonOfDate('2026-08-31')).toBe('verano');
    expect(seasonOfDate('2026-09-01')).toBe('otono');
    expect(seasonOfDate('basura')).toBeNull();
    expect(seasonOfDate('2026-02-30')).toBeNull();
  });
  it('flor por categoría (D-135)', () => {
    const by = (n: string) => flowerForCategory(DEFAULT_CATEGORIES, n, 'dalia');
    expect([by('Viajes'), by('Momentos'), by('Naturaleza'), by('Citas'), by('Otra')]).toEqual([
      'girasol',
      'camelia',
      'lavanda',
      'rosa',
      'dalia',
    ]);
  });
  it('estado inicial y suciedad', () => {
    const i = initialFields('2026-10-06', DEFAULT_CATEGORIES);
    expect(i).toMatchObject({
      category: 'Viajes',
      flower: 'girasol',
      season: 'otono',
      date: '2026-10-06',
    });
    expect(isDirty(i, { ...i }, 0)).toBe(false);
    expect(isDirty(i, { ...i, title: 'a' }, 0)).toBe(true);
    expect(isDirty(i, { ...i }, 1)).toBe(true);
  });
});

describe('orden de fotos', () => {
  it('mover, portada y quitar', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 2, 3)).toEqual([1, 2, 3]);
    expect(makeCover([1, 2, 3], 2)).toEqual([3, 1, 2]);
    expect(removeAt([1, 2, 3], 1)).toEqual([1, 3]);
  });
});
