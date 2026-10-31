import { expect, test, type Page } from '@playwright/test';
import { es } from '../../src/lib/i18n/es';
import { expectNoA11yViolations } from '../a11y/axe';

/**
 * Regresiones de lo que encontró la auditoría de accesibilidad, contra la compilación (entran en `validate`).
 * - Aviso de privacidad del primer acceso sin región con desplazamiento inalcanzable (axe, WCAG 2.1.1).
 * - La tarjeta de acceso no salta al pasar de «Comprobando…» al formulario (CLS, solo Chromium).
 * - robots.txt deja leer el `noindex`; 404 propia y privada.
 */
test.use({ serviceWorkers: 'block' });

const KDF = '{"v":1,"alg":"pbkdf2-sha256","iter":1500000,"salt":"AAAAAAAAAAAAAAAAAAAAAA"}';

async function mockParams(page: Page, body: Record<string, unknown>, delayMs = 0) {
  await page.route('**/api/auth/params**', async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

for (const vp of [
  { width: 1920, height: 950 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
])
  test(`aviso de privacidad sin caja con desplazamiento (${vp.width}×${vp.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    await mockParams(page, { configured: false });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: es['setup.privacy.title'] })).toBeVisible();
    const scrolls = await page
      .locator('.ac-privacy')
      .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(scrolls, 'el aviso no debe tener su propia caja con desplazamiento').toBe(false);
    // Se desplaza la tarjeta (no la página): si lo hace, se puede enfocar con el teclado.
    const card = await page.locator('.ac-card').evaluate((el) => ({
      scrolls: el.scrollHeight > el.clientHeight + 1,
      tabindex: el.getAttribute('tabindex'),
      role: el.getAttribute('role'),
    }));
    expect(card.tabindex, JSON.stringify(card)).toBe(card.scrolls ? '0' : null);
    if (card.scrolls) expect(card.role).toBe('region');
    const pageScrolls = await page
      .locator('.ac-page')
      .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(
      pageScrolls,
      'la página no se desplaza: las flores de las esquinas siguen a la vista',
    ).toBe(false);
    await expectNoA11yViolations(page);
  });

test('la tarjeta de acceso no salta al cargar (CLS < 0,02)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Layout Instability API solo en Chromium.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
        if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  // Respuesta lenta a propósito: así se ve primero «Comprobando…» y después el formulario.
  await mockParams(page, { configured: true, kdf: KDF, rec_salt: 'AAAAAAAAAAAAAAAAAAAAAA' }, 600);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: es['login.title'] })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls).toBeLessThan(0.02);
});

test('escritorio: la tarjeta de acceso es ancha; en móvil ocupa el ancho disponible', async ({
  page,
}) => {
  await mockParams(page, { configured: false });
  await page.setViewportSize({ width: 1920, height: 950 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: es['setup.privacy.title'] })).toBeVisible();
  expect((await page.locator('.ac-card').boundingBox())!.width).toBeGreaterThan(760);
  await page.setViewportSize({ width: 390, height: 844 });
  const box = (await page.locator('.ac-card').boundingBox())!;
  expect(box.width).toBeGreaterThan(330);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test('robots.txt deja leer el noindex: no bloquea el HTML, sí la API', async ({ request }) => {
  const body = await (await request.get('/robots.txt')).text();
  const rules = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  expect(rules).toEqual(['User-agent: *', 'Disallow: /api/']);
});

test('ruta inexistente: 404 propia, privada, accesible y con enlace al inicio', async ({
  page,
}) => {
  const response = await page.goto('/esto-no-existe');
  expect(response?.status()).toBe(404);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page).toHaveTitle(`${es['notfound.title']} · Memory Garden`);
  await expect(page.getByRole('heading', { level: 1, name: es['notfound.title'] })).toBeVisible();
  await expect(page.getByRole('link', { name: es['notfound.back'] })).toHaveAttribute('href', '/');
  await expectNoA11yViolations(page);
});

test('cada vista tiene título, descripción, idioma y viewport', async ({ page }) => {
  await page.route('**/api/auth/params**', (r) =>
    r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  for (const [path, title] of [
    ['/', es['nav.garden']],
    ['/jardin', es['nav.garden']],
    ['/ramos', es['nav.bouquets']],
    ['/explorar', es['nav.explore']],
    ['/configuracion', es['nav.settings']],
  ] as const) {
    await page.goto(path);
    await expect(page).toHaveTitle(`${title} · Memory Garden`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      es['app.description'],
    );
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      'content',
      /width=device-width/,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow, noarchive',
    );
    await expect(page.locator('meta[property^="og:"]')).toHaveCount(0);
  }
});
