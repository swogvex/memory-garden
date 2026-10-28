import { describe, expect, it } from 'vitest';
import { constantTimeEqual, fromB64Url, randomBytes, toB64Url } from '@/server/bytes';
import { loadConfig, normalizeCode } from '@/server/env';
import { ipEpoch, ipFingerprint, ipPrefix } from '@/server/ip';
import { cookieSpec } from '@/server/sessions';
import { securityHeaders } from '@/server/security-headers';
import { b64Exact, parseKdf, secretBytes, wrappedKey } from '@/server/validate';
import { PEPPER, SETUP_CODE, fakeWrapped, kdfText } from './_support';

const pepperBytes = fromB64Url(PEPPER)!;
const cfg = (env: Record<string, string | undefined>) =>
  loadConfig({ DB: {} as never, PEPPER, SETUP_CODE, ...env })!;

describe('base64url estricto', () => {
  it('ida y vuelta para todas las longitudes de 1 a 70 bytes', () => {
    for (let n = 1; n <= 70; n++) {
      const b = randomBytes(n);
      const t = toB64Url(b);
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Array.from(fromB64Url(t)!)).toEqual(Array.from(b));
    }
  });
  it('rechaza relleno, alfabeto estándar, longitudes imposibles, vacío y bits sobrantes no nulos', () => {
    expect(fromB64Url('AAAA')).not.toBeNull();
    for (const bad of ['AAA=', 'AA+A', 'AA/A', 'A', 'AAAAA', '', 'AB', 'AAB', 'ñAAA', 'AA A'])
      expect(fromB64Url(bad)).toBeNull();
    expect(fromB64Url('AAAAAAAAAAAAAAAAAAAAAB')).toBeNull(); // 22 caracteres con el último no canónico
    expect(fromB64Url('AAAAAAAAAAAAAAAAAAAAAA')).not.toBeNull();
  });
  it('b64Exact y secretBytes exigen la longitud exacta', () => {
    expect(b64Exact(toB64Url(randomBytes(16)), 16)).not.toBeNull();
    expect(b64Exact(toB64Url(randomBytes(15)), 16)).toBeNull();
    expect(b64Exact(5, 16)).toBeNull();
    expect(secretBytes(toB64Url(randomBytes(32)))).not.toBeNull();
    expect(secretBytes(toB64Url(randomBytes(31)))).toBeNull();
    expect(secretBytes(undefined)).toBeNull();
  });
  it('comparación en tiempo constante', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
  });
});

describe('huella de IP', () => {
  it('IPv4 completa; IPv6 recortada a /64; mapeada cuenta como IPv4; basura → unknown', () => {
    expect(ipPrefix('203.0.113.7')).toBe('203.0.113.7');
    expect(ipPrefix('2001:db8:1:2:3:4:5:6')).toBe('2001:0db8:0001:0002');
    expect(ipPrefix('2001:DB8::1')).toBe('2001:0db8:0000:0000');
    expect(ipPrefix('::1')).toBe('0000:0000:0000:0000');
    expect(ipPrefix('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(ipPrefix('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(ipPrefix('2001:db8:1:2:1:1:1:1'));
    for (const bad of [
      null,
      undefined,
      '',
      'hola',
      '999.1.1.1',
      '1.2.3',
      '1:2:3',
      '1::2::3',
      ':::',
      '12345::1',
      '1.2.3.4.5',
    ])
      expect(ipPrefix(bad as string)).toBe('unknown');
  });
  it('la huella dura 16 hex, es estable en su época, y cambia con la época y con la IP', async () => {
    const e = ipEpoch(1_800_000_000);
    const a = await ipFingerprint(pepperBytes, '203.0.113.7', e);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await ipFingerprint(pepperBytes, '203.0.113.7', e)).toBe(a);
    expect(await ipFingerprint(pepperBytes, '203.0.113.7', e + 1)).not.toBe(a);
    expect(await ipFingerprint(pepperBytes, '203.0.113.8', e)).not.toBe(a);
    expect(await ipFingerprint(new Uint8Array(32).fill(2), '203.0.113.7', e)).not.toBe(a); // depende del secreto
  });
});

describe('entorno y cookie', () => {
  it('normalizeCode: minúsculas, guiones, espacios, O→0, I/L→1', () => {
    expect(normalizeCode('abcde-fghjk mnpqr')).toBe('ABCDEFGHJKMNPQR');
    expect(normalizeCode('o1il-0')).toBe('01110');
  });
  it('loadConfig rechaza un PEPPER ausente, corto o con formato inválido', () => {
    for (const p of [
      undefined,
      '',
      'corto',
      toB64Url(randomBytes(31)),
      toB64Url(randomBytes(33)),
      PEPPER + '=',
    ]) {
      expect(loadConfig({ DB: {} as never, PEPPER: p })).toBeNull();
    }
    expect(loadConfig({ DB: {} as never, PEPPER })).not.toBeNull();
  });
  it('sin código de configuración válido (o demasiado corto) el primer acceso queda cerrado', () => {
    expect(loadConfig({ DB: {} as never, PEPPER })!.setupCode).toBeNull();
    expect(loadConfig({ DB: {} as never, PEPPER, SETUP_CODE: 'ABC' })!.setupCode).toBeNull();
    expect(cfg({}).setupCode).toBe(normalizeCode(SETUP_CODE));
  });
  it('EXTRA_ORIGINS solo se respeta con MG_ENV=local', () => {
    expect(
      cfg({ MG_ENV: 'local', EXTRA_ORIGINS: 'https://a.example, https://b.example' }).extraOrigins,
    ).toEqual(['https://a.example', 'https://b.example']);
    expect(cfg({ MG_ENV: undefined, EXTRA_ORIGINS: 'https://a.example' }).extraOrigins).toEqual([]);
    expect(cfg({ MG_ENV: 'production', EXTRA_ORIGINS: 'https://a.example' }).extraOrigins).toEqual(
      [],
    );
  });
  it('cookieSpec: relajada SOLO con MG_ENV=local + localhost + http; en cualquier otro caso, __Host- y Secure (PS-23)', () => {
    const local = cfg({ MG_ENV: 'local' });
    const prod = cfg({ MG_ENV: undefined });
    expect(cookieSpec(local, new URL('http://localhost:4322/'))).toEqual({
      name: 'mg_session',
      secure: false,
    });
    expect(cookieSpec(local, new URL('http://127.0.0.1:4322/'))).toEqual({
      name: 'mg_session',
      secure: false,
    });
    for (const url of [
      'https://localhost/',
      'https://x.devtunnels.ms/',
      'http://192.168.1.5:4322/',
      'https://memorygarden.date/',
    ]) {
      expect(cookieSpec(local, new URL(url))).toEqual({ name: '__Host-mg_session', secure: true });
    }
    for (const url of ['http://localhost:4322/', 'https://memorygarden.date/']) {
      expect(cookieSpec(prod, new URL(url))).toEqual({ name: '__Host-mg_session', secure: true });
    }
  });
});

describe('validación estructural', () => {
  it('parseKdf acepta solo el registro canónico dentro de suelo y techo (D-115)', () => {
    expect(parseKdf(kdfText(600_000))?.iter).toBe(600_000);
    expect(parseKdf(kdfText(10_000_000))?.iter).toBe(10_000_000);
    expect(parseKdf(kdfText(599_999))).toBeNull();
    expect(parseKdf(kdfText(10_000_001))).toBeNull();
    const ok = kdfText();
    expect(parseKdf(ok.replace('"v":1', '"v":2'))).toBeNull();
    expect(parseKdf(ok.replace('pbkdf2-sha256', 'argon2id'))).toBeNull();
    expect(parseKdf(ok.replace(',"alg"', ', "alg"'))).toBeNull(); // no canónico (espacio)
    expect(
      parseKdf(ok.replace('{"v":1,"alg":"pbkdf2-sha256",', '{"alg":"pbkdf2-sha256","v":1,')),
    ).toBeNull(); // orden distinto
    expect(parseKdf(ok.replace(/"salt":"[^"]+"/, '"salt":"corta"'))).toBeNull();
    expect(parseKdf(ok.slice(0, -1) + ',"extra":1}')).toBeNull();
    expect(parseKdf('no es json')).toBeNull();
    expect(parseKdf(5)).toBeNull();
  });
  it('wrappedKey exige 64 bytes y cabecera [1, 1, finalidad, 0]', () => {
    expect(wrappedKey(fakeWrapped('pw'), 'pw')).not.toBeNull();
    expect(wrappedKey(fakeWrapped('rec'), 'rec')).not.toBeNull();
    expect(wrappedKey(fakeWrapped('rec'), 'pw')).toBeNull();
    const b = randomBytes(64);
    b.set([2, 1, 0x10, 0]);
    expect(wrappedKey(toB64Url(b), 'pw')).toBeNull();
    b.set([1, 1, 0x10, 5]);
    expect(wrappedKey(toB64Url(b), 'pw')).toBeNull();
    expect(wrappedKey(toB64Url(randomBytes(63)), 'pw')).toBeNull();
    expect(wrappedKey(undefined, 'pw')).toBeNull();
  });
});

describe('cabeceras de seguridad (D-083)', () => {
  it('el perfil api tiene lo que dicen headers-and-csp.md §3–§5 y ninguna cabecera CORS', () => {
    const h = securityHeaders('api');
    expect(h['Cache-Control']).toBe('no-store');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('no-referrer');
    expect(h['Content-Security-Policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Permissions-Policy']).toMatch(/camera=\(\)/);
    expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(Object.keys(h).some((k) => /^access-control-/i.test(k))).toBe(false);
    expect(Object.keys(h).some((k) => /^strict-transport-security$/i.test(k))).toBe(false); // HSTS: ajuste de zona (H7.3)
  });
});
