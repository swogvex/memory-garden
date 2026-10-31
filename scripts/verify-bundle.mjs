// PS-37 (D-274): comprueba que lo que sirve el dominio es, byte a byte, la compilación local (dist/client).
//   node scripts/verify-bundle.mjs https://memorygarden.date
// `npm run deploy` lo ejecuta solo al terminar (postdeploy). Para repetirlo más tarde, compila antes EL MISMO commit
// que está desplegado (git switch --detach <commit>; npm run build).
// Detecta: archivos servidos distintos de los compilados (un despliegue hecho fuera del flujo, contenido inyectado).
// No detecta: cambios en el código del Worker (rutas /api) ni lo que haga quien controla el propio despliegue (R-27).
// Solo hace GET a archivos públicos; no envía datos ni cookies.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) {
  console.error('Uso: node scripts/verify-bundle.mjs https://tu-dominio');
  process.exit(2);
}
const ROOT = join('dist', 'client');
if (!existsSync(ROOT)) {
  console.error('No existe dist/client: compila antes (npm run build).');
  process.exit(2);
}

// Archivos que no se publican como recursos: configuración del propio Cloudflare.
const NOT_SERVED = new Set([
  '_headers',
  '_redirects',
  '_routes.json',
  '.assetsignore',
  'wrangler.json',
]);
const ignorePatterns = existsSync(join(ROOT, '.assetsignore'))
  ? readFileSync(join(ROOT, '.assetsignore'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map(
        (l) => new RegExp('^' + l.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'),
      )
  : [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(relative(ROOT, path).split(sep).join('/'));
  }
  return out;
}

/** Ruta pública de un archivo con `html_handling: "drop-trailing-slash"` (D-197). */
function urlPath(rel) {
  let path = rel;
  if (path === 'index.html') path = '';
  else if (path.endsWith('/index.html')) path = path.slice(0, -'/index.html'.length);
  else if (path.endsWith('.html')) path = path.slice(0, -'.html'.length);
  return '/' + path.split('/').map(encodeURIComponent).join('/');
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const files = walk(ROOT).filter((rel) => {
  const name = rel.split('/').at(-1);
  if (NOT_SERVED.has(name) || name.startsWith('.')) return false;
  return !ignorePatterns.some((re) => re.test(rel) || re.test(name));
});

let commit = '(desconocido)';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
    commit += ' + cambios sin confirmar';
} catch {
  /* sin Git: solo informativo */
}
console.log(`Comparando ${files.length} archivos de dist/client (commit ${commit}) con ${base}\n`);

const mismatches = [];
let ok = 0;
async function check(rel) {
  const path = urlPath(rel);
  const local = sha(readFileSync(join(ROOT, ...rel.split('/'))));
  const res = await fetch(base + path, {
    redirect: 'manual',
    headers: { 'cache-control': 'no-cache' },
  });
  const remote = sha(Buffer.from(await res.arrayBuffer()));
  const statusOk = res.status === 200 || (rel === '404.html' && res.status === 404);
  if (statusOk && remote === local) ok++;
  else
    mismatches.push(
      `${path}  (estado ${res.status}; local ${local.slice(0, 12)}…, servido ${remote.slice(0, 12)}…)`,
    );
}

const queue = [...files];
try {
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) await check(queue.shift());
    }),
  );
} catch (error) {
  console.error(
    `No se pudo conectar con ${base}: ${error?.cause?.code ?? error?.message ?? error}`,
  );
  console.error(
    'Si el error es de certificado, mira antes si hay bloqueo de LaLiga (hayahora.futbol). No desactives TLS.',
  );
  process.exit(1);
}

console.log(`Iguales: ${ok} de ${files.length}`);
if (mismatches.length) {
  console.log(`\nDISTINTOS (${mismatches.length}):`);
  for (const m of mismatches) console.log(`  ${m}`);
  console.log(
    '\nSi acabas de cambiar un archivo de /decor o /textures, puede ser la caché de un día (D-261): repite mañana.\n' +
      'Si no, trátalo como incidente: el sitio no sirve lo que compilaste (RUNBOOK, respuesta a incidentes).',
  );
  process.exit(1);
}
console.log('\nTodo OK: lo servido coincide con la compilación local.');
