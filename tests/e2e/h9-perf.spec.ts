import { expect, test, type Page } from '@playwright/test';
import { es } from '../../src/lib/i18n/es';

/**
 * H9.3 · Rendimiento de la pantalla de acceso, contra la compilación:
 * - la aplicación con sesión (Workspace: vistas, flores, sprite) no se monta en el acceso;
 * - `?medir` muestra el medidor de Web Vitals sin romper la CSP; sin `?medir` no existe.
 * H9.5 (D-266) · El marco floral (elemento LCP del acceso) está en el HTML y se pinta sin JS.
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

test.describe('H9.5 · marco floral en el HTML (LCP)', () => {
  test('el HTML de cada vista ya trae las 4 esquinas, con prioridad alta en la capa base', async ({
    request,
  }) => {
    for (const path of ['/', '/jardin', '/ramos', '/explorar', '/configuracion']) {
      const html = await (await request.get(path)).text();
      for (const c of ['c1', 'c2', 'c3', 'c4']) {
        expect(html, `${path}: ${c}`).toMatch(
          new RegExp(`<img[^>]*src="/decor/${c}-base\\.svg"[^>]*>`),
        );
        expect(html).toMatch(new RegExp(`src="/decor/${c}-sway\\.svg"`));
      }
      expect(html.match(/fetchpriority="high"/g), path).toHaveLength(4);
    }
  });

  test.describe('sin JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('las esquinas se pintan sin esperar a la isla', async ({ page }) => {
      await page.goto('/');
      const bases = page.locator('.ac-decor img.base');
      await expect(bases).toHaveCount(4);
      for (const img of await bases.all()) {
        await expect(img).toBeVisible();
        // `decode()` solo se resuelve si la imagen llegó y se puede pintar (un 404 o un SVG roto la rechazan).
        expect(
          await img.evaluate((el) =>
            (el as HTMLImageElement).decode().then(
              () => true,
              () => false,
            ),
          ),
        ).toBe(true);
      }
      await expect(page.locator('.ac-decor')).toHaveAttribute('aria-hidden', 'true');
    });
  });

  test('con la isla montada hay un solo marco, detrás de la tarjeta y sin clics', async ({
    page,
  }) => {
    await mock(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: es['login.title'] })).toBeVisible();
    await expect(page.locator('.ac-decor')).toHaveCount(1);
    await expect(page.locator('.ac-decor')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-unlocked');
    // La tarjeta queda encima del marco: en su centro, lo que hay es la tarjeta (o algo dentro de ella).
    const card = page.locator('.ac-card');
    const box = (await card.boundingBox())!;
    const onTop = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.ac-card'),
      { x: box.x + box.width / 2, y: box.y + 40 },
    );
    expect(onTop).toBe(true);
    await expect(page.locator('.ac-decor')).toHaveCSS('pointer-events', 'none');
  });
});
