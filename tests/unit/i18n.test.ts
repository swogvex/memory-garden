import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, isLocale, t } from '@/lib/i18n';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';

describe('i18n', () => {
  it('usa español por defecto y expone es/en', () => {
    expect(DEFAULT_LOCALE).toBe('es');
    expect(LOCALES).toEqual(['es', 'en']);
  });

  it('cambia la cadena de prueba al cambiar de idioma', () => {
    expect(t('es', 'dev.sample')).toBe('Cada recuerdo es una flor.');
    expect(t('en', 'dev.sample')).toBe('Every memory is a flower.');
  });

  it('cae al español si falta la traducción', () => {
    expect(t('en', 'home.intro')).toBe(es['home.intro']);
  });

  it('interpola parámetros y deja intactos los que faltan', () => {
    expect(t('es', 'dev.greeting', { name: 'Ana' })).toBe('Hola, Ana.');
    expect(t('en', 'dev.greeting')).toBe('Hello, {name}.');
  });

  it('no hay claves en inglés que no existan en español', () => {
    for (const key of Object.keys(en)) expect(key in es).toBe(true);
  });

  it('isLocale acepta solo es y en', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
