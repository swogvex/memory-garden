import { expect, test, type Page } from '@playwright/test';
import { en } from '../../src/lib/i18n/en';
import { es } from '../../src/lib/i18n/es';
import {
  applyTextSpacing,
  auditState,
  clippedText,
  expectFocusStops,
  runningAnimations,
  tabTo,
} from '../a11y/audit';

/**
 * H9.1 · Auditoría del acceso contra la COMPILACIÓN (`npm run build` antes), con la API simulada.
 * Solo se ejecuta con `npm run test:audit` (proyecto `audit`, D-248: no entra en `validate`).
 * Registra cada estado en test-results; `npm run audit:summary` hace la tabla.
 */
test.use({ serviceWorkers: 'block' });

const KDF = '{"v":1,"alg":"pbkdf2-sha256","iter":1500000,"salt":"AAAAAAAAAAAAAAAAAAAAAA"}';
const REC_SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const STRONG = 'jardín lento bajo la lluvia de octubre 2026';

type Params = Record<string, unknown> | number;
async function mockApi(
  page: Page,
  params: Params,
  login?: { status: number; body: unknown; headers?: Record<string, string> },
) {
  await page.route('**/api/auth/params**', (route) =>
    typeof params === 'number'
      ? route.fulfill({ status: params, contentType: 'application/json', body: '{}' })
      : route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(params),
        }),
  );
  if (login)
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: login.status,
        headers: login.headers,
        contentType: 'application/json',
        body: JSON.stringify(login.body),
      }),
    );
}
const configured = { configured: true, kdf: KDF, rec_salt: REC_SALT };
const fresh = { configured: false };
const invalid = { status: 401, body: { error: 'invalid_credentials' } };
const heading = (page: Page, name: string) => page.getByRole('heading', { name });

const WIDTHS = [
  { label: 'móvil 320', width: 320, height: 640 },
  { label: 'móvil 390', width: 390, height: 844 },
  { label: 'zoom 200 % de 1280×800', width: 640, height: 400 },
  { label: 'escritorio 1280', width: 1280, height: 800 },
];

test.describe('auditoría · acceso', () => {
  test('entrar: anchos, zoom 200 % y espaciado de texto', async ({ page }, testInfo) => {
    await mockApi(page, configured, invalid);
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto('/');
      await expect(heading(page, es['login.title'])).toBeVisible();
      await auditState(page, testInfo, `entrar · ${w.label}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(heading(page, es['login.title'])).toBeVisible();
    await applyTextSpacing(page);
    const clipped = await clippedText(page);
    expect.soft(clipped, 'texto recortado con el espaciado de WCAG 1.4.12').toEqual([]);
    await auditState(page, testInfo, 'entrar · espaciado de texto 1.4.12', { extra: { clipped } });
  });

  test('entrar solo con teclado: error anunciado y foco visible', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockApi(page, configured, invalid);
    await page.goto('/');
    await expect(heading(page, es['login.title'])).toBeVisible();
    const stops = await tabTo(page, { selector: 'input[type="password"]' });
    await page.keyboard.type('una contraseña cualquiera 2026');
    await page.keyboard.press('Enter');
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toContainText(es['access.error.invalid']);
    const more = await tabTo(page, { name: new RegExp(es['login.forgot']) });
    expectFocusStops([...stops, ...more], 'entrar');
    await auditState(page, testInfo, 'entrar · error de credenciales', {
      focusStops: [...stops, ...more],
    });
  });

  test('429 con cuenta atrás y estado sin conexión con el servidor', async ({ page }, testInfo) => {
    await mockApi(page, configured, {
      status: 429,
      headers: { 'Retry-After': '30' },
      body: { error: 'rate_limited', retry_after: 30 },
    });
    await page.goto('/');
    await page
      .getByLabel(es['login.password'], { exact: true })
      .fill('una contraseña cualquiera 2026');
    await page.getByRole('button', { name: es['login.submit'] }).click();
    await expect(page.getByRole('button', { name: /Reintentar en \d+ s/ })).toBeDisabled({
      timeout: 30_000,
    });
    await auditState(page, testInfo, 'entrar · 429 (espera)');

    await page.unrouteAll();
    await mockApi(page, 500);
    await page.goto('/');
    await expect(page.getByRole('button', { name: es['access.retry'] })).toBeVisible();
    await auditState(page, testInfo, 'no se pudo conectar');
  });

  test('recuperar el acceso', async ({ page }, testInfo) => {
    await mockApi(page, configured);
    await page.goto('/');
    await page
      .getByRole('button', { name: es['login.forgot'] })
      .or(page.getByRole('link', { name: es['login.forgot'] }))
      .click();
    await expect(heading(page, es['recover.title'])).toBeVisible();
    await auditState(page, testInfo, 'recuperar · clave');
  });

  test('primer acceso: aviso, contraseña, clave y comprobación', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await mockApi(page, fresh);
    await page.goto('/');
    await expect(heading(page, es['setup.privacy.title'])).toBeVisible();
    await auditState(page, testInfo, 'primer acceso · aviso de privacidad');

    await page.getByRole('checkbox', { name: es['setup.privacy.read'] }).check();
    await page.getByRole('button', { name: es['access.continue'] }).click();
    await expect(heading(page, es['setup.password.title'])).toBeVisible();
    await auditState(page, testInfo, 'primer acceso · contraseña (vacía)');

    const inputs = page.locator('input[type="password"]');
    for (let i = 0; i < (await inputs.count()); i++) await inputs.nth(i).fill(STRONG);
    await auditState(page, testInfo, 'primer acceso · contraseña con medidor');
    await page.getByRole('button', { name: es['access.continue'] }).click();
    await expect(heading(page, es['setup.key.title'])).toBeVisible({ timeout: 45_000 });
    await auditState(page, testInfo, 'primer acceso · clave de recuperación');
  });

  test('pantalla de acceso en inglés: lang="en" y textos traducidos', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('mg.lang', 'en');
      } catch {
        // sin almacenamiento
      }
    });
    await mockApi(page, configured);
    await page.goto('/');
    await expect(heading(page, en['login.title']!)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await auditState(page, testInfo, 'entrar · inglés');
  });

  test('prefers-reduced-motion: nada animado en el acceso', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockApi(page, configured);
    await page.goto('/');
    await expect(heading(page, es['login.title'])).toBeVisible();
    await page.waitForTimeout(500);
    const running = await runningAnimations(page);
    expect.soft(running, 'animaciones en marcha con reduced-motion').toEqual([]);
    await auditState(page, testInfo, 'entrar · reduced-motion', { extra: { running } });
  });
});
