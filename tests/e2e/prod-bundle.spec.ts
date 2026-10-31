import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

test('el bundle de producción no contiene la semilla ni datos de prueba', async ({
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Se comprueba una sola vez.');
  const files = walk('dist').filter((f) => /\.(js|mjs|html|css|json)$/.test(f));
  expect(files.length).toBeGreaterThan(0);

  // Cadenas literales: sobreviven a la minificación (los nombres de función no).
  const banned = ['Contraseña-solo-de-pruebas', 'Recuerdo de prueba con', 'Mañana de playa'];
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const needle of banned) if (text.includes(needle)) hits.push(`${file}: ${needle}`);
  }
  expect(hits).toEqual([]);
});

test('cada hoja de estilos de la compilación está enlazada en el HTML de las vistas (sin depender de JS)', () => {
  const css = readdirSync(join('dist', 'client', '_astro')).filter((f) => f.endsWith('.css'));
  expect(css.length).toBeGreaterThan(0);
  for (const view of ['jardin', 'ramos', 'explorar', 'configuracion']) {
    const html = readFileSync(join('dist', 'client', view, 'index.html'), 'utf8');
    const missing = css.filter((f) => !html.includes(`/_astro/${f}`));
    expect(missing, `${view}: hojas de estilo sin enlazar`).toEqual([]);
  }
});
