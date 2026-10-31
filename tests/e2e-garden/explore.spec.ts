import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Semilla de desarrollo (src/dev/seed-data.ts): 63 recuerdos entre 2025-12-31 y 2028-03-01.
const rows = (page: Page) => page.locator('button[data-memory]');
const search = (page: Page) => page.getByRole('searchbox', { name: 'Buscar en tus recuerdos' });
const count = (page: Page) => page.locator('p.count');

test.describe('Explorar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explorar');
    await expect(page.getByRole('heading', { level: 1, name: 'Explorar' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
  });

  test('todos los recuerdos, del más reciente al más antiguo, de 60 en 60', async ({ page }) => {
    await expect(rows(page)).toHaveCount(60);
    await expect(count(page)).toHaveText('63 recuerdos');
    await expect(rows(page).first()).toContainText('Primero de marzo');
    await page.getByRole('button', { name: 'Mostrar 3 más' }).click();
    await expect(rows(page)).toHaveCount(63);
    await expect(rows(page).nth(60)).toBeFocused();
    await expect(rows(page).last()).toContainText('Nochevieja');
    await expect(page.getByRole('button', { name: /^Mostrar \d+ más$/ })).toHaveCount(0);
  });

  test('busca sin distinguir mayúsculas ni tildes', async ({ page }) => {
    await search(page).fill('CASTANAS');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Castañas');
    await expect(count(page)).toHaveText('1 recuerdo');
    await search(page).fill('otoño');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Mercado de otoño');
    await search(page).fill('playa atardecer');
    await expect(rows(page)).toHaveCount(1);
  });

  test('el título con marcado se muestra como texto', async ({ page }) => {
    await search(page).fill('script');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('<script>alert(1)</script>');
    await expect(page.locator('button[data-memory] script')).toHaveCount(0);
  });

  test('filtros combinados y «Quitar filtros»', async ({ page }) => {
    const clear = page.getByRole('button', { name: 'Quitar filtros' });
    await expect(clear).toBeDisabled();
    await page.getByLabel('Categoría', { exact: true }).selectOption('Viajes');
    await expect(rows(page)).toHaveCount(10);
    await page.getByLabel('Flor', { exact: true }).selectOption('girasol');
    await expect(rows(page)).toHaveCount(10);
    await page.getByLabel('Año', { exact: true }).selectOption('2026');
    await page.getByLabel('Temporada', { exact: true }).selectOption('otono');
    await expect(rows(page)).toHaveCount(2);
    await expect(count(page)).toHaveText('2 recuerdos');
    await clear.click();
    await expect(rows(page)).toHaveCount(60);
    await expect(search(page)).toBeFocused();
    await expect(page.getByLabel('Categoría', { exact: true })).toHaveValue('');
  });

  test('sin resultados lo dice y lo anuncia', async ({ page }) => {
    await search(page).fill('zzzz');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText('No hay recuerdos con esta búsqueda')).toBeVisible();
    await expect(count(page)).toHaveText('Ningún recuerdo coincide.');
  });

  test('la búsqueda no va a la URL, al historial ni a la red', async ({ page }) => {
    const url = page.url();
    const before = await page.evaluate(() => history.length);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await search(page).fill('castanas');
    await page.getByLabel('Año', { exact: true }).selectOption('2026');
    await search(page).press('Enter');
    await expect(rows(page)).toHaveCount(1);
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => history.length)).toBe(before);
    expect(requests.filter((r) => r.toLowerCase().includes('castanas'))).toEqual([]);
    await expect(search(page)).toHaveAttribute('autocomplete', 'off');
  });

  test('solo con teclado: buscar, abrir un recuerdo y volver', async ({ page }) => {
    await search(page).focus();
    await page.keyboard.type('castanas');
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.hasAttribute('data-memory'))) break;
    }
    await expect(rows(page).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rows(page).first()).toBeFocused();
  });

  test('a 320 px no hay desbordamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(await overflow()).toBe(false);
    await search(page).fill('superlarga');
    await expect(rows(page)).toHaveCount(1);
    expect(await overflow()).toBe(false);
  });

  test('axe: sin infracciones WCAG A/AA', async ({ page }) => {
    await search(page).fill('playa');
    await expect(rows(page)).toHaveCount(2);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
