// Comprueba las cabeceras REALES de una URL desplegada (PS-32, PS-33, PS-34, PS-53, PS-56, PS-57). Solo lectura.
//   node scripts/check-headers.mjs https://memorygarden.date
// No envía datos ni cookies; hace GET/HEAD a rutas públicas y una petición protegida SIN sesión (debe dar 401).
const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) {
  console.error('Uso: node scripts/check-headers.mjs https://tu-dominio');
  process.exit(2);
}
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${name}${cond ? '' : '  → ' + detail}`);
  if (!cond) failures++;
};
const get = async (path, init = {}) => {
  const res = await fetch(base + path, { redirect: 'manual', ...init });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
};

const COMMON = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow, noarchive',
};
const common = (label, h) => {
  for (const [k, v] of Object.entries(COMMON))
    check(`${label}: ${k}`, h.get(k) === v, String(h.get(k)));
  check(
    `${label}: Permissions-Policy deniega cámara y micrófono`,
    /camera=\(\)/.test(h.get('permissions-policy') ?? '') &&
      /microphone=\(\)/.test(h.get('permissions-policy') ?? ''),
    String(h.get('permissions-policy')),
  );
  check(
    `${label}: sin Access-Control-*`,
    ![...h.keys()].some((k) => k.startsWith('access-control-')),
  );
  check(
    `${label}: sin unsafe-inline/unsafe-eval`,
    !/unsafe-(inline|eval)/.test(h.get('content-security-policy') ?? ''),
  );
};

for (const path of ['/', '/jardin']) {
  const r = await get(path);
  check(`GET ${path}: 200`, r.status === 200, String(r.status));
  common(`HTML ${path}`, r.headers);
  const csp = r.headers.get('content-security-policy') ?? '';
  check(
    `HTML ${path}: CSP con frame-ancestors 'none', connect-src 'self', sin script-src en la cabecera`,
    /frame-ancestors 'none'/.test(csp) && /connect-src 'self'/.test(csp) && !/script-src/.test(csp),
    csp,
  );
  check(
    `HTML ${path}: Cache-Control no-cache`,
    /no-cache/.test(r.headers.get('cache-control') ?? ''),
    String(r.headers.get('cache-control')),
  );
  check(
    `HTML ${path}: la <meta> de CSP lleva hashes`,
    /http-equiv="content-security-policy"[^>]*sha256-/i.test(r.text) ||
      /sha256-[^>]*http-equiv="content-security-policy"/i.test(r.text),
  );
  const host = base.replace(/^https:\/\//, '').replace(/\./g, '\\.');
  const foreign = new RegExp(`<(script|link)[^>]+(src|href)="https?://(?!${host})`, 'i');
  check(`HTML ${path}: sin <script src> ni <link> de otro dominio`, !foreign.test(r.text));
}

const api = await get('/api/memories');
check(
  'API sin sesión: 401 genérico',
  api.status === 401 && JSON.parse(api.text).error === 'unauthorized',
  `${api.status} ${api.text.slice(0, 80)}`,
);
common('API', api.headers);
check(
  'API: Cache-Control no-store',
  /no-store/.test(api.headers.get('cache-control') ?? ''),
  String(api.headers.get('cache-control')),
);
check(
  "API: CSP default-src 'none'",
  /default-src 'none'/.test(api.headers.get('content-security-policy') ?? ''),
);
const photo = await get('/api/assets/AAAAAAAAAAAAAAAAAAAAAA');
check('Foto sin sesión: 401 (nunca accesible por URL)', photo.status === 401, String(photo.status));
const opt = await get('/api/memories', { method: 'OPTIONS' });
check(
  'OPTIONS: 405 y sin CORS',
  opt.status === 405 && !opt.headers.get('access-control-allow-origin'),
  String(opt.status),
);

const robots = await get('/robots.txt');
check(
  'robots.txt: solo Disallow: /api/ (el HTML se rastrea para que se lea el noindex, D-258)',
  robots.status === 200 &&
    /^Disallow: \/api\/$/m.test(robots.text) &&
    !/^Disallow: \/\s*$/m.test(robots.text),
  String(robots.status),
);

const hsts = base ? (await get('/')).headers.get('strict-transport-security') : null;
console.log(
  `INFO  Strict-Transport-Security: ${hsts ?? '(ausente)'}  — lo fija la zona de Cloudflare (D-088, escalera de §10.6)`,
);
console.log(
  `INFO  Report-To: ${(await get('/')).headers.get('report-to') ?? '(ausente)'} · NEL: ${(await get('/')).headers.get('nel') ?? '(ausente)'}  — PS-53`,
);
console.log(
  `INFO  Set-Cookie en la portada: ${(await get('/')).headers.get('set-cookie') ?? '(ninguna)'}  — PS-57 (no debe haber cookies de Cloudflare)`,
);

try {
  const http = await fetch(base.replace('https://', 'http://') + '/', { redirect: 'manual' });
  check(
    'HTTP → HTTPS: redirige (3xx a https)',
    http.status >= 300 && http.status < 400 && /^https:/.test(http.headers.get('location') ?? ''),
    `${http.status} ${http.headers.get('location')}`,
  );
} catch {
  console.log('INFO  http:// no responde (puerto 80 cerrado): aceptable si HTTPS funciona');
}

console.log(failures === 0 ? '\nTodo OK.' : `\n${failures} comprobación(es) fallida(s).`);
process.exit(failures === 0 ? 0 : 1);
