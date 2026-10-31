import type { Page } from '@playwright/test';
import { es } from '../../src/lib/i18n/es';
import { expect, test } from './fixtures';

/**
 * Ramos con historial (D-264) y recuerdos en memoria entre secciones (D-262), contra `astro dev` con la semilla.
 */
test.use({ timezoneId: 'Europe/Madrid', locale: 'es-ES' });

const KEY = '2026-10';
const months = (page: Page) => page.locator('button[data-key]');
const flower = (page: Page) => page.locator('.mg-fl').first();
const navLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: es['nav.label'] }).getByRole('link', { name, exact: true });

async function openRamos(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00+02:00'));
  await page.goto('/ramos');
  await expect(months(page)).toHaveCount(12, { timeout: 45_000 });
}

test('Atrás cierra el ramo y vuelve a los meses; Adelante lo reabre', async ({ page }) => {
  await openRamos(page);
  await page.locator(`button[data-key="${KEY}"]`).click();
  await expect(flower(page)).toBeVisible();
  await page.goBack();
  await expect(months(page)).toHaveCount(12);
  await expect(page).toHaveURL(/\/ramos\/?$/);
  await expect(page.locator(`button[data-key="${KEY}"]`)).toBeFocused();
  await page.goForward();
  await expect(flower(page)).toBeVisible();
});

test('el botón «Todos los meses» y Atrás llevan al mismo sitio sin dejar entradas de más', async ({
  page,
}) => {
  await openRamos(page);
  await page.locator(`button[data-key="${KEY}"]`).click();
  await expect(flower(page)).toBeVisible();
  await page.getByRole('button', { name: es['bouquets.back'] }).click();
  await expect(months(page)).toHaveCount(12);
  // El botón ya consumió la entrada del ramo: Atrás sale de Ramos (a donde se llegó antes, aquí la página inicial).
  await expect(page.locator(`button[data-key="${KEY}"]`)).toBeFocused();
});

test('ir al Jardín desde un ramo abierto y volver con Atrás reabre ese ramo', async ({ page }) => {
  await openRamos(page);
  await page.locator(`button[data-key="${KEY}"]`).click();
  await expect(flower(page)).toBeVisible();
  await navLink(page, es['nav.garden']).click();
  await expect(page).toHaveURL(/\/jardin\/?$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/ramos\/?$/);
  await expect(flower(page)).toBeVisible();
});

test('al volver a una sección no aparece «Abriendo tu jardín…» (recuerdos en memoria)', async ({
  page,
}) => {
  await openRamos(page);
  await navLink(page, es['nav.garden']).click();
  await expect(page.getByRole('grid')).toBeVisible();
  // Desde aquí se apunta si el aviso llega a aparecer en algún momento.
  await page.evaluate((text) => {
    const w = window as unknown as { __sawLoading: boolean };
    w.__sawLoading = false;
    new MutationObserver(() => {
      if (document.body.innerText.includes(text)) w.__sawLoading = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, es['garden.loading']);
  await navLink(page, es['nav.bouquets']).click();
  await expect(months(page)).toHaveCount(12);
  await navLink(page, es['nav.garden']).click();
  await expect(page.getByRole('grid')).toBeVisible();
  const saw = await page.evaluate(
    () => (window as unknown as { __sawLoading: boolean }).__sawLoading,
  );
  expect(saw).toBe(false);
});
