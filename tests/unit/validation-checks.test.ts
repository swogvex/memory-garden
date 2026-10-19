// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isCalendarDate, isHttpUrl } from '../../src/lib/validation/checks';

describe('fechas de calendario AAAA-MM-DD (D-024)', () => {
  it('acepta fechas reales, incluido 29 de febrero solo en bisiesto', () => {
    for (const d of [
      '2024-02-29',
      '2000-02-29',
      '2026-12-31',
      '2027-01-01',
      '2026-02-28',
      '1900-01-31',
      '2026-04-30',
    ]) {
      expect(isCalendarDate(d)).toBe(true);
    }
    for (const d of [
      '2023-02-29',
      '1900-02-29',
      '2100-02-29',
      '2026-04-31',
      '2026-06-31',
      '2026-13-01',
      '2026-00-10',
      '2026-01-00',
      '2026-1-1',
      '26-01-01',
      '2026/01/01',
      '2026-01-01T00:00',
      ' 2026-01-01',
      '',
      'hoy',
    ]) {
      expect(isCalendarDate(d)).toBe(false);
    }
    expect(isCalendarDate(20260101)).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
  });
  it('no depende de la zona horaria del equipo', () => {
    const prev = process.env['TZ'];
    for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'Europe/Madrid']) {
      process.env['TZ'] = tz;
      expect(isCalendarDate('2026-10-25')).toBe(true); // día del cambio de hora en Europa
      expect(isCalendarDate('2026-03-29')).toBe(true);
    }
    if (prev === undefined) delete process.env['TZ'];
    else process.env['TZ'] = prev;
  });
});

describe('enlaces: solo http(s) (PS-29)', () => {
  it('acepta http y https normales', () => {
    for (const u of [
      'https://example.com',
      'http://example.com/a?b=1#c',
      'HTTPS://Example.COM/ruta',
      'https://sub.dominio.es:8443/x',
    ]) {
      expect(isHttpUrl(u)).toBe(true);
    }
  });
  it('rechaza esquemas peligrosos, relativos, vacíos, con credenciales, con espacios o controles', () => {
    for (const u of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>',
      'vbscript:x',
      'file:///etc/passwd',
      'ftp://x.com',
      '//evil.example',
      '/ruta',
      'example.com',
      'https:example.com',
      'https:/example.com',
      'https://',
      'https:// ',
      'https://confianza.com@malo.com',
      'https://u:p@x.com',
      'https://a b.com',
      'https://a.com/\n',
      'https://a.com/\t',
      'https://a.com/\u0000',
      ' https://a.com',
      'https://a.com ',
      '',
      '   ',
      'https://' + 'a'.repeat(2050),
    ]) {
      expect(isHttpUrl(u)).toBe(false);
    }
    expect(isHttpUrl(undefined)).toBe(false);
    expect(isHttpUrl(5)).toBe(false);
  });
});
