/**
 * Cabeceras de seguridad, definidas UNA vez (D-083, headers-and-csp.md §2 y §8) y aplicadas por dos caminos:
 *  - respuestas del Worker (`/api/*`): `applySecurityHeaders` (todas, errores incluidos);
 *  - assets (HTML prerrenderizado, `/_astro/*`): `public/_headers`, que se GENERA a partir de este módulo
 *    (`renderHeadersFile()`) y cuya igualdad con el archivo guardado vigila `tests/unit/server/headers.test.ts` (PS-59).
 * La CSP de HTML va en DOS partes (D-085): la `<meta>` de Astro (hashes de `script-src`/`style-src`, se añade en la compilación)
 * y esta cabecera con todo lo demás, SIN `script-src`, `style-src` ni `default-src` (se cumplirían a la vez y bloquearían los hashes).
 * No hay `Access-Control-*`: sin CORS (PS-31). HSTS lo emite el ajuste de zona de Cloudflare, no este código (§10.6).
 */
export type HeaderKind = 'api' | 'html';

const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'accelerometer=()',
  'gyroscope=()',
  'magnetometer=()',
  'browsing-topics=()',
].join(', ');

const COMMON: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': PERMISSIONS_POLICY,
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

/** CSP de las respuestas que no son HTML (JSON de la API, binarios cifrados). */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/**
 * CSP de cabecera para HTML (headers-and-csp.md §3.2). Las fotos se descifran en el navegador y se muestran con `blob:`; sin `data:`.
 * Sin `upgrade-insecure-requests`: WebKit sube a https los recursos incluso en `http://127.0.0.1` y el preview de las pruebas
 * (http) deja de cargar el CSS y el JS. En producción no hace falta: Cloudflare solo sirve por HTTPS, HSTS lo emite la zona
 * y todas las URLs de la aplicación son relativas y del mismo origen.
 */
export const HTML_CSP = [
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "frame-src 'none'",
  "img-src 'self' blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
].join('; ');

/** Rutas de HTML prerrenderizado (una por vista de la isla, `VIEW_SLUGS`): se revalidan siempre (D-054, §6). */
export const HTML_PATHS = ['/', '/jardin*', '/ramos*', '/explorar*', '/configuracion*'] as const;

/**
 * Adornos y texturas de `public/` (D-261). No llevan hash en el nombre (los de `/_astro/*` sí y son inmutables):
 * caché de un día. Antes (sin regla) Cloudflare los servía con `max-age=0, must-revalidate` y cada visita hacía una
 * petición por archivo. Si se regeneran, pueden tardar hasta un día en verse en un navegador que ya los tenga.
 */
export const STATIC_ASSET_PATHS = ['/decor/*', '/textures/*'] as const;
export const STATIC_ASSET_CACHE = 'public, max-age=86400';

export function securityHeaders(kind: HeaderKind): Record<string, string> {
  if (kind === 'api')
    return { ...COMMON, 'Content-Security-Policy': API_CSP, 'Cache-Control': 'no-store' };
  // El `Cache-Control` del HTML se pone por ruta en `_headers` (no en `/*`: pisaría el inmutable de `/_astro/*`).
  return { ...COMMON, 'Content-Security-Policy': HTML_CSP };
}

export function applySecurityHeaders(headers: Headers, kind: HeaderKind): void {
  for (const [name, value] of Object.entries(securityHeaders(kind))) {
    // Una ruta puede endurecer Cache-Control (p. ej. `private, no-store` en las fotos); nunca se afloja a otra cosa.
    if (name === 'Cache-Control' && /no-store/i.test(headers.get('Cache-Control') ?? '')) continue;
    headers.set(name, value);
  }
}

/**
 * Contenido EXACTO de `public/_headers` (formato de Workers static assets: regla de ruta y cabeceras con sangría de 2 espacios).
 * El adaptador de Cloudflare añade al final su propia regla `/_astro/*` (Cache-Control inmutable): no se duplica aquí.
 */
export function renderHeadersFile(): string {
  const lines = [
    '# GENERADO desde src/server/security-headers.ts (renderHeadersFile). No editar a mano: lo vigila tests/unit/server/headers.test.ts.',
    '# Solo para assets; las respuestas del Worker (/api/*) llevan las suyas por código (D-083).',
    '/*',
    ...Object.entries(securityHeaders('html')).map(([k, v]) => `  ${k}: ${v}`),
  ];
  for (const path of HTML_PATHS) lines.push(path, '  Cache-Control: no-cache');
  for (const path of STATIC_ASSET_PATHS) lines.push(path, `  Cache-Control: ${STATIC_ASSET_CACHE}`);
  return lines.join('\n') + '\n';
}
