// H9.1 · Ejecuta la auditoría de accesibilidad (proyectos `audit` y `audit-garden`, solo Chromium) y su resumen.
// Requiere `npm run build` antes (el proyecto `audit` va contra la compilación). No entra en `validate` (D-248).
// Uso: npm run test:audit                  → toda la auditoría
//      npm run test:audit -- access        → solo los archivos cuyo nombre contenga «access»
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('src/lib/i18n/es.ts') || !existsSync('tests/e2e-garden/fixtures.ts')) {
  console.error(
    'Esto no parece el repositorio de Memory Garden: ejecuta el comando en su carpeta.',
  );
  process.exit(2);
}
const extra = process.argv.slice(2);
const env = { ...process.env, MG_AUDIT: '1' };

// Playwright con su CLI local (sin npx, que podría descargar paquetes) y el resumen con el mismo Node.
const cli = 'node_modules/@playwright/test/cli.js';
const status =
  spawnSync(
    process.execPath,
    [cli, 'test', '--project=audit', '--project=audit-garden', '--workers=2', ...extra],
    { stdio: 'inherit', env },
  ).status ?? 1;
spawnSync(process.execPath, ['scripts/audit-summary.mjs'], { stdio: 'inherit' });
process.exit(status);
