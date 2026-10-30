import { expect, test, type Page } from '@playwright/test';
import { es } from '../../src/lib/i18n/es';
import { expectNoA11yViolations } from '../a11y/axe';

/**
 * Compilación de producción sin sesión (H7.5): solo se ve la pantalla de acceso, a página completa,
 * sin menú ni cabecera. La navegación de la aplicación con sesión se prueba en
 * `tests/e2e-garden/shell.spec.ts` (servidor de desarrollo con datos de prueba).
 */

const ROUTES = [
  { slug: 'jardin', label: es['nav.garden'] },
  { slug: 'ramos', label: es['nav.bouquets'] },
  { slug: 'explorar', label: es['nav.explore'] },
  { slug: 'configuracion', label: es['nav.settings'] },
] as const;

const nav = (page: Page) => page.getByRole('navigation', { name: es['nav.label'] });
const brand = (page: Page) => page.getByRole('heading', { level: 1, name: es['app.name'] });

/** Sin servidor de acceso (como en la compilación sin Worker): `/jardin` muestra «No se pudo conectar». */
const serverDown = (page: Page) =>
  page.route('**/api/auth/params', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );

for (const { slug, label } of ROUTES) {
  test(`/${slug} sin sesión: solo la pantalla de acceso, sin errores ni dominios externos`, async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const external: string[] = [];
    const errors: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'data:' || url.protocol === 'blob:') return;
      if (url.origin !== origin) external.push(request.url());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`/${slug}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page).toHaveTitle(new RegExp(`^${label} · Memory Garden$`));
    await expect(brand(page)).toBeVisible();
    await expect(page.locator('main#contenido')).toHaveCount(1);
    await expect(nav(page)).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await expectNoA11yViolations(page);

    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
}

test('en la compilación de producción, sin servidor, el acceso muestra su estado de error (sin datos de prueba)', async ({
  page,
}) => {
  await serverDown(page);
  await page.goto('/jardin');
  await expect(page.getByRole('alert')).toContainText(es['access.unavailable.title']);
  await expect(page.getByRole('button', { name: es['access.retry'] })).toBeEnabled();
  await expectNoA11yViolations(page);
});

test('móvil: el acceso cabe desde 320 px, con objetivos de 44 px y sin menú', async ({ page }) => {
  await serverDown(page);
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/jardin');
    const retry = page.getByRole('button', { name: es['access.retry'] });
    await expect(retry).toBeVisible();
    await expect(nav(page)).toHaveCount(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `desbordamiento a ${width}px`).toBeLessThanOrEqual(0);
    const box = await retry.boundingBox();
    expect(box!.height, `«Reintentar» a ${width}px`).toBeGreaterThanOrEqual(44);
    await expectNoA11yViolations(page);
  }
});

test('los adornos del acceso son decorativos: ocultos y sin texto alternativo', async ({
  page,
}) => {
  await serverDown(page);
  await page.goto('/jardin');
  await expect(page.getByRole('button', { name: es['access.retry'] })).toBeVisible();
  const decor = page.locator('.ac-decor');
  await expect(decor).toHaveAttribute('aria-hidden', 'true');
  const alts = await decor
    .locator('img')
    .evaluateAll((imgs) => imgs.map((i) => i.getAttribute('alt')));
  expect(alts.length).toBe(8);
  expect(alts.every((a) => a === '')).toBe(true);
});

test('orden de tabulación sin sesión: enlace de salto y después el acceso', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'El WebKit de Playwright no incluye enlaces en Tab (D-121).');
  await page.setViewportSize({ width: 1280, height: 800 });
  await serverDown(page);
  await page.goto('/jardin');
  await expect(page.getByRole('button', { name: es['access.retry'] })).toBeVisible();

  const order: string[] = [];
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(() =>
        (
          document.activeElement?.getAttribute('aria-label') ??
          document.activeElement?.textContent ??
          ''
        ).trim(),
      ),
    );
  }
  expect(order).toEqual([es['a11y.skipToContent'], es['access.retry']]);
});
