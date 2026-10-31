import { expect, test, type Page } from '@playwright/test';
import { es } from '../../src/lib/i18n/es';

/**
 * H9.3 · Rendimiento de la pantalla de acceso, contra la compilación:
 * - la aplicación con sesión (Workspace: vistas, flores, sprite) no se monta en el acceso;
 * - `?medir` muestra el medidor de Web Vitals sin romper la CSP; sin `?medir` no existe.
 */
test.use({ serviceWorkers: 'block' });

const configured = {
  configured: true,
  kdf: '{"v":1,"alg":"pbkdf2-sha256","iter":1500000,"salt":"AAAAAAAAAAAAAAAAAAAAAA"}',
  rec_salt: 'AAAAAAAAAAAAAAAAAAAAAA',
};
const mock = (page: Page) =>
  page.route('**/api/auth/params**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(configured) }),
  );

test('el acceso no monta la aplicación: ni sprite de flores ni menú', async ({ page }) => {
  await mock(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: es['login.title'] })).toBeVisible();
  await expect(page.locator('.sprite')).toHaveCount(0);
  await expect(page.locator('svg symbol')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: es['nav.label'] })).toHaveCount(0);
});

test('?medir muestra el medidor sin violaciones de CSP; sin ?medir no aparece', async ({
  page,
}) => {
  const csp: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text());
  });
  await mock(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: es['login.title'] })).toBeVisible();
  await expect(page.locator('#mg-vitals')).toHaveCount(0);

  await page.goto('/?medir');
  const box = page.locator('#mg-vitals');
  await expect(box).toBeVisible();
  await expect(box).toContainText('LCP');
  await expect(box).toContainText('INP');
  await expect(box).toHaveAttribute('aria-hidden', 'true');
  expect(csp).toEqual([]);
});
