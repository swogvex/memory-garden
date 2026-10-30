// Humo de H7.1 contra el servidor de desarrollo en marcha (npm run dev). Solo local.
//   node scripts/smoke-h7-1.mjs <CÓDIGO-DE-PRIMER-ACCESO> [http://localhost:4321]
// Usa cargas SINTÉTICAS con la forma correcta (no hay criptografía aquí): comprueba red, cookies, 401/403/429 y el primer acceso.
// Tras ejecutarlo la cuenta queda creada: para repetir, para el servidor y haz `npm run dev:reset -- --yes`.
import { randomBytes } from 'node:crypto';

const code = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:4321';
if (!code) {
  console.error('Uso: node scripts/smoke-h7-1.mjs <código> [url]');
  process.exit(2);
}
const b64 = (n) => randomBytes(n).toString('base64url');
const wrapped = (purpose) => {
  const bytes = randomBytes(64);
  bytes.set([1, 1, purpose, 0]);
  return bytes.toString('base64url');
};
const authPw = b64(32);
const authRec = b64(32);
const setupBody = (setup_code) => ({
  setup_code,
  vault_id: b64(16),
  kdf: `{"v":1,"alg":"pbkdf2-sha256","iter":1500000,"salt":"${b64(16)}"}`,
  auth_pw: authPw,
  rec_salt: b64(16),
  auth_rec: authRec,
  wrapped_mk_pw: wrapped(0x10),
  wrapped_mk_rec: wrapped(0x11),
  mk_version: 1,
});

let failures = 0;
let lastText = '';
async function call(method, path, { body, cookie, origin = base } = {}) {
  const headers = { Origin: origin };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    redirect: 'manual',
  });
  const text = await res.text();
  lastText = text;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* no JSON */
  }
  return {
    status: res.status,
    json,
    text,
    headers: res.headers,
    setCookie: res.headers.getSetCookie(),
  };
}
function check(name, cond, detail = '') {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${name}${cond ? '' : '  → ' + detail}`);
  if (!cond && lastText)
    console.log(
      `        cuerpo recibido (primeros 400 caracteres): ${JSON.stringify(lastText.slice(0, 400))}`,
    );
  if (!cond) failures++;
}

let r = await call('GET', '/api/auth/params');
check(
  '1. params antes del alta: 200 y configured=false',
  r.status === 200 && r.json?.configured === false,
  JSON.stringify(r),
);

for (const [m, p] of [
  ['POST', '/api/auth/logout'],
  ['PUT', '/api/vault/password'],
  ['PUT', '/api/vault/kdf'],
  ['PUT', '/api/vault/recovery-key'],
  ['PUT', '/api/vault/recovery-reset'],
]) {
  r = await call(m, p);
  check(
    `2. sin sesión ${m} ${p}: 401 unauthorized`,
    r.status === 401 && r.json?.error === 'unauthorized',
    `${r.status} ${JSON.stringify(r.json)}`,
  );
}

r = await call('POST', '/api/auth/login', {
  body: { auth_pw: authPw },
  origin: 'https://evil.example',
});
check('3. Origin ajeno: 403', r.status === 403, String(r.status));

r = await call('POST', '/api/setup', { body: setupBody('AAAAA-AAAAA-AAAAA-AAAAA-AAAAA') });
check(
  '4. primer acceso con código erróneo: 401 genérico',
  r.status === 401 && r.json?.error === 'invalid_credentials',
  `${r.status} ${JSON.stringify(r.json)}`,
);

r = await call('POST', '/api/setup', { body: setupBody(code) });
const cookieHeader = r.setCookie[0] ?? '';
check(
  '5. primer acceso con el código correcto: 200',
  r.status === 200 && r.json?.key_revision === 1,
  `${r.status} ${JSON.stringify(r.json)}`,
);
check(
  '5b. cookie mg_session con HttpOnly y SameSite=Strict (sin Secure solo en localhost)',
  /^mg_session=/.test(cookieHeader) &&
    /HttpOnly/.test(cookieHeader) &&
    /SameSite=Strict/.test(cookieHeader) &&
    !/Secure/.test(cookieHeader),
  cookieHeader,
);
const cookie = cookieHeader.split(';')[0];

r = await call('POST', '/api/setup', { body: setupBody(code) });
check(
  '6. repetir el primer acceso: 401 genérico, no crea otra cuenta',
  r.status === 401 && r.json?.error === 'invalid_credentials',
  `${r.status} ${JSON.stringify(r.json)}`,
);

r = await call('GET', '/api/auth/params');
check(
  '7. params después del alta: configured=true',
  r.json?.configured === true,
  JSON.stringify(r.json),
);

r = await call('POST', '/api/auth/logout', { cookie });
check('8. cerrar sesión con la cookie: 204', r.status === 204, String(r.status));
r = await call('POST', '/api/auth/logout', { cookie });
check('8b. la misma cookie después de cerrar sesión: 401', r.status === 401, String(r.status));

let throttled = null;
for (let i = 1; i <= 8 && !throttled; i++) {
  r = await call('POST', '/api/auth/login', { body: { auth_pw: b64(32) } });
  if (r.status !== 401 && r.status !== 429)
    check(`9. fallo de login ${i}: 401`, false, String(r.status));
  if (r.status === 429) throttled = { attempt: i, retry: r.headers.get('retry-after') };
}
check(
  '9. la fuerza bruta se frena con 429 y Retry-After',
  throttled !== null && Number(throttled.retry) > 0,
  JSON.stringify(throttled),
);
if (throttled) {
  r = await call('POST', '/api/auth/login', { body: { auth_pw: authPw } });
  check(
    '9b. bloqueado, incluso la contraseña correcta recibe 429',
    r.status === 429,
    String(r.status),
  );
  await new Promise((res) => setTimeout(res, (Number(throttled.retry) + 1) * 1000));
  r = await call('POST', '/api/auth/login', { body: { auth_pw: authPw } });
  check(
    '9c. pasada la espera, el acceso correcto entra (200 + cookie)',
    r.status === 200 && r.setCookie.length === 1,
    `${r.status} ${JSON.stringify(r.json)}`,
  );
}

console.log(failures === 0 ? '\nTodo OK.' : `\n${failures} comprobación(es) fallida(s).`);
process.exit(failures === 0 ? 0 : 1);
