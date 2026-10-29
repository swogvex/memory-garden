/**
 * Cabeceras de seguridad, definidas UNA vez (D-083, headers-and-csp.md §2 y §8).
 * H7.1 solo cablea el perfil `api` (todas las respuestas de /api/*, errores incluidos).
 * El perfil de HTML, la CSP completa y la paridad con `public/_headers` llegan en H7.3.
 * No hay `Access-Control-*`: sin CORS (PS-31). HSTS lo emite el ajuste de zona de Cloudflare, no este código.
 */
export type HeaderKind = 'api';

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

const API_ONLY: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Cache-Control': 'no-store',
};

export function securityHeaders(kind: HeaderKind): Record<string, string> {
  return kind === 'api' ? { ...COMMON, ...API_ONLY } : { ...COMMON };
}

export function applySecurityHeaders(headers: Headers, kind: HeaderKind): void {
  for (const [name, value] of Object.entries(securityHeaders(kind))) {
    // Una ruta puede endurecer Cache-Control (p. ej. `private, no-store` en las fotos); nunca se afloja a otra cosa.
    if (name === 'Cache-Control' && /no-store/i.test(headers.get('Cache-Control') ?? '')) continue;
    headers.set(name, value);
  }
}
