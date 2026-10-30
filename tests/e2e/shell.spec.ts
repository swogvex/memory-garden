import { expect, test, type Page } from '@playwright/test';
import { es } from '../../src/lib/i18n/es';
import { expectNoA11yViolations } from '../a11y/axe';

const ROUTES = [
  { slug: 'jardin', label: es['nav.garden'] },
  { slug: 'ramos', label: es['nav.bouquets'] },
  { slug: 'explorar', label: es['nav.explore'] },
  { slug: 'configuracion', label: es['nav.settings'] },
] as const;

const nav = (page: Page) => page.getByRole('navigation', { name: es['nav.label'] });
const navLink = (page: Page, name: string) => nav(page).getByRole('link', { name, exact: true });
const spaFlag = (page: Page) =>
  page.evaluate(() => (window as unknown as Record<string, unknown>).__mgSpa);

/** Sin servidor de acceso (como en la compilación sin Worker): `/jardin` muestra «No se pudo conectar». */
const serverDown = (page: Page) =>
  page.route('**/api/auth/params', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );

for (const { slug, label } of ROUTES) {
  test(`/${slug}: carga directa con título, enlace activo, sin errores ni dominios externos`, async ({
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
    await expect(navLink(page, label)).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle(new RegExp(`^${label} · Memory Garden$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoA11yViolations(page);

    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
}

test('navegar entre secciones no recarga la página y actualiza URL, título y foco', async ({
  page,
}) => {
  await page.goto('/jardin');
  await expect(navLink(page, es['nav.garden'])).toHaveAttribute('aria-current', 'page');
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__mgSpa = true;
  });

  for (const { slug, label } of ROUTES.slice(1)) {
    await navLink(page, label).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/?$`));
    await expect(navLink(page, label)).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle(new RegExp(`^${label} ·`));
    await expect(page.getByRole('heading', { level: 1, name: label })).toBeFocused();
  }
  expect(await spaFlag(page)).toBe(true);

  await page.goBack();
  await expect(page).toHaveURL(/\/explorar\/?$/);
  await expect(navLink(page, es['nav.explore'])).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL(/\/ramos\/?$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/explorar\/?$/);
  expect(await spaFlag(page)).toBe(true);
});

test('el avatar abre Configuración', async ({ page }) => {
  await page.goto('/jardin');
  await page.getByRole('link', { name: es['shell.avatar'] }).click();
  await expect(page).toHaveURL(/\/configuracion\/?$/);
  await expect(page.getByRole('heading', { level: 1, name: es['nav.settings'] })).toBeFocused();
});

test('en la compilación de producción, sin servidor, el acceso muestra su estado de error (sin datos de prueba)', async ({
  page,
}) => {
  await serverDown(page);
  await page.goto('/jardin');
  await expect(page.getByRole('alert')).toContainText(es['access.unavailable.title']);
  await expect(page.getByRole('button', { name: es['access.retry'] })).toBeEnabled();
  await expectNoA11yViolations(page);
});

test('móvil: barra inferior, objetivos de 44 px, etiquetas completas y sin desbordamiento desde 320 px', async ({
  page,
}) => {
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/jardin');
    await expect(navLink(page, es['nav.garden'])).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `desbordamiento a ${width}px`).toBeLessThanOrEqual(0);

    const bar = await nav(page).boundingBox();
    expect(bar!.y + bar!.height, `barra pegada abajo a ${width}px`).toBeGreaterThanOrEqual(699);
    await expect(nav(page).getByRole('link', { name: 'Memory Garden' })).toHaveCount(0);

    for (const { label } of ROUTES) {
      const link = navLink(page, label);
      const box = await link.boundingBox();
      expect(box!.height, `${label} a ${width}px`).toBeGreaterThanOrEqual(44);
      const clipped = await link
        .locator('.label')
        .evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(clipped, `etiqueta «${label}» cortada a ${width}px`).toBe(false);
    }
    await expectNoA11yViolations(page);
  }
});

test('escritorio: menú lateral con la marca visible', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/jardin');
  const box = await nav(page).boundingBox();
  expect(box!.x).toBe(0);
  expect(box!.width).toBeGreaterThan(200);
  await expect(nav(page).getByRole('link', { name: 'Memory Garden' })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('se puede navegar solo con teclado (Enter en un enlace del menú)', async ({ page }) => {
  await page.goto('/jardin');
  await navLink(page, es['nav.explore']).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/explorar\/?$/);
  await expect(page.getByRole('heading', { level: 1, name: es['nav.explore'] })).toBeFocused();
});

test('orden de tabulación: enlace de salto, menú, perfil y contenido', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'El WebKit de Playwright no incluye enlaces en Tab (D-121).');
  await page.setViewportSize({ width: 1280, height: 800 });
  await serverDown(page);
  await page.goto('/jardin');
  await expect(page.getByRole('button', { name: es['access.retry'] })).toBeVisible();

  const order: string[] = [];
  for (let i = 0; i < 8; i++) {
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
  expect(order).toEqual([
    es['a11y.skipToContent'],
    'Memory Garden',
    es['nav.garden'],
    es['nav.bouquets'],
    es['nav.explore'],
    es['nav.settings'],
    es['shell.avatar'],
    es['access.retry'],
  ]);
});
