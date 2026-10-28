// Reinicio TOTAL del estado LOCAL (D-022): borra `.wrangler/state` y vuelve a aplicar las migraciones.
// Es un script de tu equipo, no una ruta del Worker: en producción no existe nada equivalente.
//   npm run dev:reset -- --yes     (para antes el servidor de desarrollo)
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('.dev.vars') || !/^MG_ENV=local\s*$/m.test(readFileSync('.dev.vars', 'utf8'))) {
  console.error(
    'Rechazado: hace falta un .dev.vars con MG_ENV=local (señal de que esto es un entorno de desarrollo).',
  );
  process.exit(1);
}
if (!process.argv.includes('--yes')) {
  console.error(
    'Esto borra TODA la base de datos y los archivos locales. Repite con: npm run dev:reset -- --yes',
  );
  process.exit(1);
}
rmSync('.wrangler/state', { recursive: true, force: true });
console.log('Estado local borrado. Aplicando migraciones...');
const r = spawnSync(
  'npx',
  ['wrangler', 'd1', 'migrations', 'apply', 'memory-garden-db', '--local'],
  { stdio: 'inherit', shell: true },
);
process.exit(r.status ?? 1);
