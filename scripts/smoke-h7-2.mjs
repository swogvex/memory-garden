// Humo de H7.2 contra el servidor de desarrollo en marcha (npm run dev). Solo local.
//   node scripts/smoke-h7-2.mjs <CÓDIGO-DE-PRIMER-ACCESO> [http://localhost:4321]
// Cargas SINTÉTICAS con la forma correcta (sin criptografía): comprueba D1 + R2 locales de verdad, cabeceras, límites y borrado.
// Necesita la cuenta SIN crear: `npm run dev:reset -- --yes` antes (con el servidor parado) y luego `npm run dev`.
import { randomBytes } from 'node:crypto';

const code = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:4321';
if (!code) {
  console.error('Uso: node scripts/smoke-h7-2.mjs <código> [url]');
  process.exit(2);
}
const b64 = (n) => randomBytes(n).toString('base64url');
const wrapped = (purpose) => {
  const bytes = randomBytes(64);
  bytes.set([1, 1, purpose, 0]);
  return bytes.toString('base64url');
};
const payload = (n = 200) => {
  const bytes = randomBytes(n);
  bytes.set([1, 1, 1, 1]);
  return bytes.toString('base64url');
};
const asset = (n) => {
  const bytes = Buffer.alloc(n);
  for (let i = 0; i < n; i += 65536) randomBytes(Math.min(65536, n - i)).copy(bytes, i);
  bytes.set([1, 1, 2, 1]);
  return bytes;
};

let failures = 0;
let lastText = '';
async function call(method, path, { json, bytes, cookie, headers: extra = {} } = {}) {
  const headers = { Origin: base, ...extra };
  let body;
  if (bytes) {
    headers['Content-Type'] = 'application/octet-stream';
    body = bytes;
  } else if (method === 'POST' || method === 'PUT') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json ?? {});
  }
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { method, headers, body, redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  lastText = buf.toString('utf8').slice(0, 400);
  let parsed = null;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch {
    /* binario o vacío */
  }
  return {
    status: res.status,
    json: parsed,
    buf,
    headers: res.headers,
    setCookie: res.headers.getSetCookie(),
  };
}
function check(name, cond, detail = '') {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${name}${cond ? '' : '  → ' + detail}`);
  if (!cond && lastText) console.log(`        último cuerpo: ${JSON.stringify(lastText)}`);
  if (!cond) failures++;
}

const setup = await call('POST', '/api/setup', {
  json: {
    setup_code: code,
    vault_id: b64(16),
    kdf: `{"v":1,"alg":"pbkdf2-sha256","iter":1500000,"salt":"${b64(16)}"}`,
    auth_pw: b64(32),
    rec_salt: b64(16),
    auth_rec: b64(32),
    wrapped_mk_pw: wrapped(0x10),
    wrapped_mk_rec: wrapped(0x11),
    mk_version: 1,
  },
});
if (setup.status !== 200) {
  console.error(
    `No se pudo crear la cuenta (${setup.status}). ¿Hiciste «npm run dev:reset -- --yes» con el servidor parado?`,
  );
  process.exit(2);
}
const cookie = setup.setCookie[0].split(';')[0];

const memId = b64(16);
const photoId = b64(16);
const thumbId = b64(16);
const photo = asset(300_000);
const thumb = asset(20_000);

let r = await call('GET', '/api/memories');
check('1. sin sesión: 401', r.status === 401);
r = await call('GET', '/api/memories', { cookie });
check(
  '2. lista vacía: 200',
  r.status === 200 && r.json?.items?.length === 0,
  JSON.stringify(r.json),
);

r = await call('PUT', `/api/assets/${photoId}?kind=photo`, { cookie, bytes: photo });
check('3. subir foto (300 KB): 201', r.status === 201, `${r.status}`);
r = await call('PUT', `/api/assets/${thumbId}?kind=thumb&parent=${photoId}`, {
  cookie,
  bytes: thumb,
});
check('3b. subir miniatura: 201', r.status === 201, `${r.status}`);
r = await call('GET', `/api/assets/${photoId}`, { cookie });
check('4. foto sin ligar aún no se sirve: 404', r.status === 404, `${r.status}`);

r = await call('PUT', `/api/memories/${memId}`, {
  cookie,
  json: { payload: payload(), expected_revision: null, asset_ids: [photoId, thumbId] },
});
check(
  '5. crear recuerdo con sus fotos: 200, revisión 1',
  r.status === 200 && r.json?.revision === 1,
  `${r.status} ${JSON.stringify(r.json)}`,
);
r = await call('GET', `/api/assets/${photoId}`, { cookie });
check(
  '6. foto ligada: 200 y los mismos bytes',
  r.status === 200 && r.buf.equals(photo),
  `${r.status} ${r.buf.length}`,
);
check(
  '6b. Cache-Control private, no-store; octet-stream; nosniff',
  /no-store/.test(r.headers.get('cache-control') ?? '') &&
    /private/.test(r.headers.get('cache-control') ?? '') &&
    r.headers.get('content-type') === 'application/octet-stream' &&
    r.headers.get('x-content-type-options') === 'nosniff',
  JSON.stringify([...r.headers]),
);
r = await call('GET', `/api/assets/${photoId}`);
check('6c. la misma foto sin sesión: 401', r.status === 401, `${r.status}`);

r = await call('PUT', `/api/memories/${memId}`, {
  cookie,
  json: { payload: payload(250), expected_revision: 1, asset_ids: [photoId, thumbId] },
});
check(
  '7. editar con la revisión correcta: revisión 2',
  r.status === 200 && r.json?.revision === 2,
  `${r.status}`,
);
r = await call('PUT', `/api/memories/${memId}`, {
  cookie,
  json: { payload: payload(), expected_revision: 1, asset_ids: [photoId, thumbId] },
});
check(
  '7b. editar con revisión vieja: 409 con la versión actual',
  r.status === 409 && r.json?.current?.revision === 2,
  `${r.status}`,
);

r = await call('PUT', `/api/assets/${b64(16)}?kind=photo`, {
  cookie,
  bytes: asset(2 * 1024 * 1024 + 1),
});
check('8. foto de más de 2 MiB: 413', r.status === 413, `${r.status}`);
r = await call('PUT', `/api/assets/${b64(16)}?kind=photo`, { cookie, bytes: Buffer.alloc(500) });
check('8b. cuerpo sin cabecera de sobre válida: 400', r.status === 400, `${r.status}`);

r = await call('DELETE', `/api/memories/${memId}`, { cookie });
check('9. purgar uno visible: 409', r.status === 409, `${r.status}`);
r = await call('POST', `/api/memories/${memId}/trash`, { cookie });
check('9b. a la papelera: 200', r.status === 200 && r.json?.deleted_at > 0, `${r.status}`);
r = await call('GET', '/api/memories', { cookie });
check('9c. ya no sale en la lista normal', r.json?.items?.length === 0, JSON.stringify(r.json));
r = await call('POST', `/api/memories/${memId}/restore`, { cookie });
check('9d. restaurar: 200', r.status === 200 && r.json?.deleted_at === null, `${r.status}`);
await call('POST', `/api/memories/${memId}/trash`, { cookie });
r = await call('DELETE', `/api/memories/${memId}`, { cookie });
check('10. borrado definitivo: 204', r.status === 204, `${r.status}`);
r = await call('GET', `/api/assets/${photoId}`, { cookie });
check('10b. la foto ya no existe: 404', r.status === 404, `${r.status}`);
r = await call('GET', `/api/memories/${memId}`, { cookie });
check('10c. el recuerdo ya no existe: 404', r.status === 404, `${r.status}`);

console.log(failures === 0 ? '\nTodo OK.' : `\n${failures} comprobación(es) fallida(s).`);
process.exit(failures === 0 ? 0 : 1);
