import { expect, test } from '@playwright/test';
import { es } from '../../src/lib/i18n/es';
import { expectNoA11yViolations } from '../a11y/axe';

test('la portada es la app: sin sesión solo el acceso; privada, accesible y sin dominios externos', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.origin !== origin) external.push(request.url());
  });

  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');

  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page).toHaveTitle(/Memory Garden/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  // Ya no hay portada provisional. `/` abre la app y, sin sesión, solo se ve el acceso.
  await expect(page.getByRole('heading', { level: 1, name: es['app.name'] })).toBeVisible();
  await expect(page.getByRole('navigation', { name: es['nav.label'] })).toHaveCount(0);
  await expect(page.locator('main#contenido')).toHaveCount(1);
  await expect(page.getByText('La base del proyecto está lista')).toHaveCount(0);

  await expectNoA11yViolations(page);

  // El acceso lleva el foco a su encabezado al cargar, así que el orden de Tab desde el principio
  // se prueba en `shell.spec.ts`. Aquí: el enlace de salto existe, recibe foco y apunta al contenido.
  const skip = page.getByRole('link', { name: es['a11y.skipToContent'] });
  await skip.focus();
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute('href', '#contenido');
  await expectNoA11yViolations(page);

  expect(external).toEqual([]);
});

test('no hay rutas de desarrollo en la compilación (PS-06)', async ({ request }) => {
  const response = await request.get('/dev/componentes');
  expect(response.status()).toBe(404);
});
