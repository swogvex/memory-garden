import { expect, test } from '@playwright/test';
import { es } from '../../src/lib/i18n/es';
import { expectNoA11yViolations } from '../a11y/axe';

test('la portada es privada, accesible y no llama a dominios externos', async ({
  page,
  baseURL,
  browserName,
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
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await expectNoA11yViolations(page);

  const skip = page.getByRole('link', { name: es['a11y.skipToContent'] });
  if (browserName === 'webkit') {
    // Safari no incluye los enlaces en el orden de Tab por defecto (se usa Opción+Tab):
    // se comprueba el enlace de salto con foco programático.
    await skip.focus();
  } else {
    await page.keyboard.press('Tab');
  }
  await expect(skip).toBeFocused();
  await expectNoA11yViolations(page);

  expect(external).toEqual([]);
});

test('la página de componentes no existe en la compilación', async ({ request }) => {
  const response = await request.get('/dev/componentes');
  expect(response.status()).toBe(404);
});
