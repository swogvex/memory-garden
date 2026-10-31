import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  API_CSP,
  HTML_CSP,
  HTML_PATHS,
  renderHeadersFile,
  securityHeaders,
} from '@/server/security-headers';
import { doSetup, makeHarness } from './_support';

/** PS-32, PS-33, PS-51, PS-58 (parte estática), PS-59: cabeceras definidas una vez y aplicadas por dos caminos sin divergir. */
const FILE = readFileSync('public/_headers', 'utf8');

describe('public/_headers (PS-59)', () => {
  it('es EXACTAMENTE lo que genera renderHeadersFile(): si cambias las cabeceras, regenera el archivo', () => {
    expect(FILE).toBe(renderHeadersFile());
  });

  it('respeta los límites de Workers static assets: ≤ 100 reglas y ≤ 2.000 caracteres por línea', () => {
    const lines = FILE.split('\n');
    const rules = lines.filter((l) => l !== '' && !l.startsWith('#') && !l.startsWith(' '));
    expect(rules.length).toBeLessThanOrEqual(100);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(2000);
  });

  it('el Cache-Control del HTML va solo en sus rutas: `/*` no lo lleva (pisaría el inmutable de /_astro/* que añade el adaptador)', () => {
    const lines = FILE.split('\n');
    const first = lines.slice(0, lines.indexOf('/'));
    expect(first.join('\n')).not.toMatch(/Cache-Control/i);
    for (const p of HTML_PATHS) expect(FILE).toContain(`${p}\n  Cache-Control: no-cache`);
    expect(FILE).not.toMatch(/immutable|max-age/i);
  });
});

describe('CSP (D-085, PS-58)', () => {
  it('la cabecera de HTML NO declara script-src, style-src ni default-src (los hashes van en la <meta> de Astro)', () => {
    for (const d of ['script-src', 'style-src', 'default-src']) expect(HTML_CSP).not.toContain(d);
  });

  it('lleva lo que solo funciona en cabecera y cierra todo lo demás', () => {
    for (const d of [
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "form-action 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "img-src 'self' blob:",
    ]) {
      expect(HTML_CSP).toContain(d);
    }
    expect(HTML_CSP).not.toMatch(/data:|https?:|\*/); // sin data:, sin orígenes de terceros, sin comodines
  });

  it('no lleva upgrade-insecure-requests: WebKit sube a https los recursos del preview http y la aplicación no arranca', () => {
    expect(HTML_CSP).not.toContain('upgrade-insecure-requests');
    expect(FILE).not.toContain('upgrade-insecure-requests');
  });

  it('en ningún perfil aparece unsafe-inline, unsafe-eval ni unsafe-hashes', () => {
    for (const csp of [HTML_CSP, API_CSP, FILE])
      expect(csp).not.toMatch(/unsafe-(inline|eval|hashes)/);
  });

  it('la CSP de la API cierra todo: default-src none', () => {
    expect(API_CSP).toContain("default-src 'none'");
    expect(API_CSP).toContain("frame-ancestors 'none'");
  });
});

describe('resto de cabeceras (PS-32, PS-51)', () => {
  for (const kind of ['api', 'html'] as const) {
    it(`perfil ${kind}: nosniff, no-referrer, DENY, COOP/CORP same-origin, Permissions-Policy, noindex y ningún Access-Control-*`, () => {
      const h = securityHeaders(kind);
      expect(h['X-Content-Type-Options']).toBe('nosniff');
      expect(h['Referrer-Policy']).toBe('no-referrer');
      expect(h['X-Frame-Options']).toBe('DENY');
      expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
      expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin');
      expect(h['Permissions-Policy']).toContain('camera=()');
      expect(h['X-Robots-Tag']).toBe('noindex, nofollow, noarchive');
      expect(Object.keys(h).some((k) => k.toLowerCase().startsWith('access-control-'))).toBe(false);
      expect(h['Cross-Origin-Embedder-Policy']).toBeUndefined(); // §4: no se pone
      expect(h['Strict-Transport-Security']).toBeUndefined(); // lo emite la zona de Cloudflare (§10.6), nunca los dos
    });
  }

  it('la API lleva Cache-Control no-store; el perfil HTML no lo fija aquí', () => {
    expect(securityHeaders('api')['Cache-Control']).toBe('no-store');
    expect(securityHeaders('html')['Cache-Control']).toBeUndefined();
  });

  it('las cabeceras comunes son idénticas en los dos perfiles (paridad entre los dos caminos)', () => {
    const without = (h: Record<string, string>, ...drop: string[]): Record<string, string> =>
      Object.fromEntries(Object.entries(h).filter(([k]) => !drop.includes(k)));
    const api = without(securityHeaders('api'), 'Content-Security-Policy', 'Cache-Control');
    const html = without(securityHeaders('html'), 'Content-Security-Policy');
    expect(api).toEqual(html);
  });

  it('robots.txt deja leer el noindex y solo cierra la API (D-258; higiene, no seguridad)', () => {
    expect(readFileSync('public/robots.txt', 'utf8')).toBe('User-agent: *\nDisallow: /api/\n');
  });
});

describe('camino del Worker: cada respuesta de /api/* lleva el perfil completo (PS-32, PS-33)', () => {
  it('éxito, error 4xx, 404, 405 y 401: mismas cabeceras de seguridad', async () => {
    const h = makeHarness();
    const { cookie } = await doSetup(h);
    const expected = securityHeaders('api');
    const replies = [
      await h.call('GET', '/api/auth/params'),
      await h.call('GET', '/api/memories', { cookie }),
      await h.call('GET', '/api/memories'), // 401
      await h.call('GET', '/api/nada'), // 404
      await h.call('PATCH', '/api/memories'), // 405
      await h.call('PUT', '/api/memories/x', { cookie, rawBody: 'no json' }), // 400/…
    ];
    for (const r of replies) {
      for (const [k, v] of Object.entries(expected))
        expect(r.headers.get(k), `${r.status} ${k}`).toBe(v);
    }
  });
});
