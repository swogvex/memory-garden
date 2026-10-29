import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * PS-59 sobre la COMPILACIÓN: `dist/client/_headers` conserva nuestras reglas y la regla inmutable de `/_astro/*` que
 * añade el adaptador, sin duplicar ninguna cabecera (dos valores se combinarían con comas). Se ejecuta tras `npm run build`.
 */
test('dist/client/_headers: nuestras reglas + la inmutable de /_astro/*, sin cabeceras repetidas', () => {
  const text = readFileSync('dist/client/_headers', 'utf8');
  expect(text).toContain('Content-Security-Policy: base-uri');
  expect(text).toContain('X-Content-Type-Options: nosniff');
  expect(text).toMatch(/\/_astro\/\*\s+Cache-Control: public, max-age=31536000, immutable/);

  // Para cada regla de ruta, ninguna cabecera aparece dos veces.
  const blocks = text.split(/\n(?=\S)/).filter((b) => !b.startsWith('#'));
  for (const block of blocks) {
    const names = block
      .split('\n')
      .slice(1)
      .map((l) => l.trim().split(':')[0]?.toLowerCase())
      .filter(Boolean);
    expect(new Set(names).size, `cabecera repetida en la regla «${block.split('\n')[0]}»`).toBe(
      names.length,
    );
  }
});
