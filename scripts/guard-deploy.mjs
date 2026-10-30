// Se niega a desplegar con el id de D1 de marcador (wrangler podría, si no, aprovisionar una base por su cuenta).
import { readFileSync } from 'node:fs';

const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
if (readFileSync('wrangler.jsonc', 'utf8').includes(PLACEHOLDER)) {
  console.error(
    'Despliegue cancelado: wrangler.jsonc aún tiene el id de D1 de marcador (H7.3 lo sustituye por el real).',
  );
  process.exit(1);
}
