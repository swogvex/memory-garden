// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  FLOWERS,
  MAX_CATEGORIES,
  ValidationError,
  parseMemoryPayload,
  parseSettings,
} from '../../src/lib/validation';

/**
 * Esquemas de Valibot (D-041). Estas pruebas necesitan el paquete `valibot` instalado.
 */
const ID = 'B'.repeat(22);
const good = () => ({
  title: 'Cena en Granada',
  date: '2026-10-17',
  category: 'Citas',
  text: 'Línea 1\nLínea 2 con <script>alert(1)</script> y "comillas"',
  link: 'https://example.com/ruta?x=1',
  flower: 'rosa',
  season: 'otono',
  photos: [{ assetId: ID, thumbId: ID, alt: 'Dos copas sobre una mesa' }],
});

function issues(fn: () => unknown): readonly { path: string; rule: string }[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof ValidationError) return e.issues;
    throw e;
  }
  throw new Error('se esperaba ValidationError');
}

describe('esquema del recuerdo', () => {
  it('acepta un recuerdo válido y conserva el texto tal cual (nada se interpreta como HTML)', () => {
    const out = parseMemoryPayload(good());
    expect(out.text).toContain('<script>alert(1)</script>');
    expect(out).toEqual(good());
  });

  it('acepta enlace nulo y cero fotos', () => {
    expect(parseMemoryPayload({ ...good(), link: null, photos: [] }).link).toBeNull();
  });

  it('rechaza campos de más (strictObject) y campos que faltan', () => {
    expect(issues(() => parseMemoryPayload({ ...good(), extra: 1 })).length).toBeGreaterThan(0);
    const sinLink = Object.fromEntries(Object.entries(good()).filter(([k]) => k !== 'link'));
    expect(issues(() => parseMemoryPayload(sinLink)).some((i) => i.path === 'link')).toBe(true);
  });

  it('título: obligatorio, ≤ 120, sin controles ni solo espacios', () => {
    for (const title of ['', '   ', 'a'.repeat(121), 'a\nb', 'a\u0000b', '\ud800']) {
      expect(
        issues(() => parseMemoryPayload({ ...good(), title })).some((i) => i.path === 'title'),
      ).toBe(true);
    }
    expect(parseMemoryPayload({ ...good(), title: 'a'.repeat(120) }).title.length).toBe(120);
  });

  it('texto: ≤ 5000, admite saltos de línea, rechaza otros controles', () => {
    expect(() => parseMemoryPayload({ ...good(), text: '' })).not.toThrow();
    expect(
      issues(() => parseMemoryPayload({ ...good(), text: 'a'.repeat(5001) })).some(
        (i) => i.path === 'text',
      ),
    ).toBe(true);
    expect(
      issues(() => parseMemoryPayload({ ...good(), text: 'a\u0001' })).some(
        (i) => i.path === 'text',
      ),
    ).toBe(true);
  });

  it('fecha AAAA-MM-DD real (PS-27/D-024)', () => {
    for (const date of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '']) {
      expect(
        issues(() => parseMemoryPayload({ ...good(), date })).some((i) => i.path === 'date'),
      ).toBe(true);
    }
    expect(parseMemoryPayload({ ...good(), date: '2024-02-29' }).date).toBe('2024-02-29');
  });

  it('enlace solo http/https (PS-29)', () => {
    for (const link of [
      'javascript:alert(1)',
      'data:text/html,x',
      '//evil.example',
      'ftp://x.com',
      'https://a@b.com',
      'example.com',
    ]) {
      expect(
        issues(() => parseMemoryPayload({ ...good(), link })).some((i) => i.path === 'link'),
      ).toBe(true);
    }
  });

  it('flor y temporada solo del catálogo; máximo 5 fotos; ids de 22 caracteres', () => {
    expect(
      issues(() => parseMemoryPayload({ ...good(), flower: 'plastico' })).some(
        (i) => i.path === 'flower',
      ),
    ).toBe(true);
    expect(
      issues(() => parseMemoryPayload({ ...good(), season: 'monzon' })).some(
        (i) => i.path === 'season',
      ),
    ).toBe(true);
    const p = { assetId: ID, thumbId: ID, alt: '' };
    expect(
      issues(() => parseMemoryPayload({ ...good(), photos: [p, p, p, p, p, p] })).some(
        (i) => i.path === 'photos',
      ),
    ).toBe(true);
    expect(parseMemoryPayload({ ...good(), photos: [p, p, p, p, p] }).photos.length).toBe(5);
    expect(
      issues(() => parseMemoryPayload({ ...good(), photos: [{ ...p, assetId: 'corto' }] })).length,
    ).toBeGreaterThan(0);
  });

  it('los errores NO contienen texto del usuario (ni en la ruta, ni en la regla, ni en el mensaje)', () => {
    const secret = 'MI-SECRETO-PERSONAL-12345';
    let err: unknown;
    try {
      parseMemoryPayload({
        ...good(),
        title: secret + '\u0000',
        category: secret,
        date: secret,
        link: secret,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    const dump =
      JSON.stringify((err as ValidationError).issues) +
      (err as Error).message +
      String((err as Error).stack).split('\n')[0];
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain('SECRETO');
  });
});

describe('esquema de ajustes', () => {
  const settings = () => ({
    displayName: 'Lucía',
    welcomeMessage: 'Bienvenida\na tu jardín',
    language: 'es',
    dateFormat: 'dmy',
    timeZone: 'Europe/Madrid',
    avatar: { kind: 'preset', id: 'dalia' },
    categories: [{ name: 'Viajes', flower: 'girasol' }],
  });

  it('acepta ajustes válidos, avatar nulo o de recurso', () => {
    expect(parseSettings(settings())).toEqual(settings());
    expect(parseSettings({ ...settings(), avatar: null }).avatar).toBeNull();
    expect(
      parseSettings({ ...settings(), avatar: { kind: 'asset', assetId: ID }, timeZone: null })
        .avatar,
    ).toEqual({ kind: 'asset', assetId: ID });
  });

  it('límites: nombre ≤ 60, mensaje ≤ 500, idioma/formato del catálogo, categorías ≤ MAX_CATEGORIES', () => {
    expect(
      issues(() => parseSettings({ ...settings(), displayName: 'a'.repeat(61) })).some(
        (i) => i.path === 'displayName',
      ),
    ).toBe(true);
    expect(
      issues(() => parseSettings({ ...settings(), welcomeMessage: 'a'.repeat(501) })).some(
        (i) => i.path === 'welcomeMessage',
      ),
    ).toBe(true);
    expect(
      issues(() => parseSettings({ ...settings(), language: 'fr' })).some(
        (i) => i.path === 'language',
      ),
    ).toBe(true);
    expect(
      issues(() => parseSettings({ ...settings(), dateFormat: 'iso' })).some(
        (i) => i.path === 'dateFormat',
      ),
    ).toBe(true);
    const cats = Array.from({ length: MAX_CATEGORIES + 1 }, () => ({
      name: 'X',
      flower: FLOWERS[0],
    }));
    expect(
      issues(() => parseSettings({ ...settings(), categories: cats })).some(
        (i) => i.path === 'categories',
      ),
    ).toBe(true);
    expect(
      issues(() => parseSettings({ ...settings(), timeZone: 'Europe/Madrid; DROP TABLE' })).some(
        (i) => i.path === 'timeZone',
      ),
    ).toBe(true);
  });
});
