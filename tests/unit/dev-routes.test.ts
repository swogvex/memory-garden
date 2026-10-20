import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('rutas de desarrollo (PS-06)', () => {
  it('no queda ninguna página bajo src/pages/dev', () => {
    const dir = 'src/pages/dev';
    expect(!existsSync(dir) || readdirSync(dir).length === 0).toBe(true);
  });

  it('la ruta de componentes solo se inyecta con command === "dev"', () => {
    const source = readFileSync('astro-integrations/dev-routes.mjs', 'utf8');
    expect(source).toMatch(/command\s*!==\s*'dev'/);
  });
});
