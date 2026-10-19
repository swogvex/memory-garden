// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_CONTENT_BYTES } from '../../src/lib/crypto/constants';
import { MAX_PHOTOS_PER_MEMORY } from '../../src/lib/storage/limits';
import {
  isCalendarDate,
  isCleanText,
  isHttpUrl,
  isNotBlank,
} from '../../src/lib/validation/checks';
import {
  FLOWERS,
  LIMITS,
  MAX_CATEGORIES,
  MAX_PHOTOS,
  SEASONS,
} from '../../src/lib/validation/limits';

const utf8Len = (s: string): number => new TextEncoder().encode(s).length;
const ID = 'A'.repeat(22);

describe('texto limpio: sin controles ni sustitutos sueltos', () => {
  it('rechaza controles; el texto largo admite \\t \\n \\r y nada más', () => {
    expect(isCleanText('Hola, mundo ñ € 😀')).toBe(true);
    for (const bad of [
      'a\u0000b',
      'a\u0001b',
      'a\u001fb',
      'a\u007fb',
      'a\u0085b',
      'a\u009fb',
      'a\nb',
      'a\tb',
      'a\rb',
    ]) {
      expect(isCleanText(bad)).toBe(false);
    }
    expect(isCleanText('a\nb\tc\r\nd', true)).toBe(true);
    for (const bad of ['a\u0000b', 'a\u000bb', 'a\u000cb', 'a\u001bb', 'a\u007fb'])
      expect(isCleanText(bad, true)).toBe(false);
  });

  it('rechaza sustitutos UTF-16 sueltos (JSON.stringify los escribe con 6 bytes) y acepta pares válidos', () => {
    expect(JSON.stringify('\ud800')).toBe('"\\ud800"'); // por qué importa
    for (const bad of ['\ud800', '\udc00', 'a\ud83d', '\ude00b', '\ud83dx\ude00'])
      expect(isCleanText(bad)).toBe(false);
    expect(isCleanText('😀')).toBe(true);
    expect(isCleanText('a😀b')).toBe(true);
  });

  it('isNotBlank: solo espacios no cuenta como contenido', () => {
    expect(isNotBlank('   ')).toBe(false);
    expect(isNotBlank(' 　')).toBe(false);
    expect(isNotBlank(' a ')).toBe(true);
  });
});

describe('cota de tamaño: un recuerdo VÁLIDO en longitud cabe siempre en el cubo máximo', () => {
  it('peor caso (cada unidad UTF-16 con 3 bytes UTF-8) ≤ MAX_CONTENT_BYTES', () => {
    const e = '€'; // 1 unidad UTF-16, 3 bytes en UTF-8: el peor carácter permitido
    const link = 'https://a.es/' + e.repeat(LIMITS.link - 'https://a.es/'.length);
    expect(isHttpUrl(link)).toBe(true);
    expect(link.length).toBe(LIMITS.link);
    const photo = { assetId: ID, thumbId: ID, alt: e.repeat(LIMITS.alt) };
    const worst = {
      title: e.repeat(LIMITS.title),
      date: '2026-12-31',
      category: e.repeat(LIMITS.category),
      text: e.repeat(LIMITS.text),
      link,
      flower: 'hortensia', // el identificador más largo del catálogo
      season: 'primavera',
      photos: Array.from({ length: MAX_PHOTOS }, () => photo),
    };
    const bytes = utf8Len(JSON.stringify(worst));
    expect(bytes).toBeLessThanOrEqual(MAX_CONTENT_BYTES);
    expect(bytes).toBeLessThan(MAX_CONTENT_BYTES * 0.9); // con margen: ajustar límites exige revisar esta cota
    // la comilla y la barra invertida ocupan 2 bytes por unidad (< 3): no empeoran el caso
    expect(utf8Len(JSON.stringify('"'.repeat(10)))).toBe(2 + 20);
  });

  it('peor caso de los ajustes también cabe', () => {
    const e = '€';
    const worst = {
      displayName: e.repeat(LIMITS.displayName),
      welcomeMessage: e.repeat(LIMITS.welcome),
      language: 'es',
      dateFormat: 'dmy',
      timeZone: 'America/Argentina/ComodRivadavia',
      avatar: { kind: 'asset', assetId: ID },
      categories: Array.from({ length: MAX_CATEGORIES }, () => ({
        name: e.repeat(LIMITS.category),
        flower: 'hortensia',
      })),
    };
    expect(utf8Len(JSON.stringify(worst))).toBeLessThanOrEqual(MAX_CONTENT_BYTES);
  });

  it('el identificador de flor más largo del catálogo es el supuesto del cálculo', () => {
    expect(Math.max(...FLOWERS.map((f) => f.length))).toBe('hortensia'.length);
    expect(Math.max(...SEASONS.map((s) => s.length))).toBe('primavera'.length);
  });

  it('los límites de validación y los de almacenamiento no se desincronizan', () => {
    expect(MAX_PHOTOS).toBe(MAX_PHOTOS_PER_MEMORY);
  });
});

describe('fechas y enlaces (completan validation-checks)', () => {
  it('rango de años acotado (1900–2200) para no aceptar basura', () => {
    expect(isCalendarDate('1899-12-31')).toBe(false);
    expect(isCalendarDate('2201-01-01')).toBe(false);
    expect(isCalendarDate('1900-01-01')).toBe(true);
    expect(isCalendarDate('2200-12-31')).toBe(true);
  });
});
