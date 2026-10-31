import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, isLocale, t } from '@/lib/i18n';
import { en } from '../../src/lib/i18n/en';
import { es, type MessageKey } from '../../src/lib/i18n/es';

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
    // `en` está completo: se borra una clave un momento para probar la caída al español.
    const saved = en['app.tagline'];
    delete en['app.tagline'];
    try {
      expect(t('en', 'app.tagline')).toBe(es['app.tagline']);
    } finally {
      en['app.tagline'] = saved;
    }
  });

  it('el inglés tiene todas las claves del español', () => {
    const missing = (Object.keys(es) as MessageKey[]).filter((key) => !(key in en));
    expect(missing).toEqual([]);
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
