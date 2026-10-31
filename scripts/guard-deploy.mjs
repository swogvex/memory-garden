// Comprobaciones antes de desplegar (D-171, D-257, D-273). Lo ejecuta `npm run deploy` antes de compilar.
// Se niega a desplegar si:
//   1. wrangler.jsonc aún tiene el id de D1 de marcador (wrangler podría aprovisionar una base por su cuenta);
//   2. no estás en `main`;
//   3. hay cambios sin confirmar o archivos nuevos sin versionar (entrarían en la compilación sin pasar por el CI);
//   4. `main` local no coincide con `origin/main` (todo lo que se despliega debe haber pasado por PR y CI).
// No comprueba que el CI de ese commit esté en verde: eso se mira en GitHub antes de fusionar.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

function fail(message) {
  console.error(`\nDespliegue cancelado: ${message}\n`);
  process.exit(1);
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

if (readFileSync('wrangler.jsonc', 'utf8').includes(PLACEHOLDER)) {
  fail('wrangler.jsonc aún tiene el id de D1 de marcador.');
}

let branch;
try {
  branch = git('rev-parse', '--abbrev-ref', 'HEAD');
} catch {
  fail('no se pudo leer Git. Ejecuta el despliegue desde la carpeta del repositorio.');
}
if (branch !== 'main') fail(`estás en «${branch}», no en main. Haz: git switch main; git pull`);

const pending = git('status', '--porcelain');
if (pending) fail(`hay cambios sin confirmar o archivos sin versionar:\n${pending}`);

try {
  git('fetch', '--quiet', 'origin', 'main');
} catch {
  fail('no se pudo consultar origin/main (¿sin conexión con GitHub?).');
}
const local = git('rev-parse', 'HEAD');
const remote = git('rev-parse', 'origin/main');
if (local !== remote) {
  fail(
    `main local (${local.slice(0, 7)}) no coincide con origin/main (${remote.slice(0, 7)}).\n` +
      'Haz git pull. Si tienes commits locales sin subir, pásalos por una PR antes de desplegar.',
  );
}

console.log(
  `Comprobaciones previas OK: main = origin/main = ${local.slice(0, 7)} y el árbol está limpio.`,
);
