import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const now = new Date();
const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

const openMonth = async (page: Page) => {
  await page.locator(`button[data-key="${key}"]`).click();
  await expect(page.locator('.mg-fl').first()).toBeVisible();
};

const openCurrent = async (page: Page) => {
  await page.goto('/ramos');
  await openMonth(page);
};

test.describe('Ramos', () => {
  test('12 meses y el ramo del mes actual con flores accesibles', async ({ page }) => {
    await page.goto('/ramos');
    await expect(page.getByRole('heading', { level: 1, name: 'Ramos' })).toBeVisible();
    await expect(page.locator('button[data-key]')).toHaveCount(12);
    await page.locator(`button[data-key="${key}"]`).click();
    const flowers = page.locator('.mg-fl');
    await expect(flowers.first()).toBeVisible();
    const n = await flowers.count();
    for (let i = 0; i < n; i++) {
      await expect(flowers.nth(i)).toHaveAttribute('role', 'button');
      expect(((await flowers.nth(i).getAttribute('aria-label')) ?? '').length).toBeGreaterThan(3);
    }
    expect(await page.locator('button[data-memory]').count()).toBeGreaterThanOrEqual(n);
  });

  test('una flor abre su recuerdo con teclado y Escape devuelve el foco', async ({ page }) => {
    await openCurrent(page);
    await page.locator('.mg-fl').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.mg-fl').first()).toBeFocused();
  });

  test('la composición no cambia al reabrir el mes', async ({ page }) => {
    await openCurrent(page);
    const snap = () => page.locator('.mg-fl').evaluateAll((els) => els.map((e) => e.innerHTML));
    const a = await snap();
    await page.getByRole('button', { name: /Todos los meses/ }).click();
    await openMonth(page);
    expect(await snap()).toEqual(a);
  });

  test('a 320 px no hay desbordamiento horizontal (rejilla y detalle)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/ramos');
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await expect(page.locator('button[data-key]').first()).toBeVisible();
    expect(await overflow()).toBe(false);
    await page.locator(`button[data-key="${key}"]`).click();
    await expect(page.locator('.mg-fl').first()).toBeVisible();
    expect(await overflow()).toBe(false);
  });

  test('con prefers-reduced-motion las flores no se animan', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openCurrent(page);
    const name = await page
      .locator('.mg-fl')
      .first()
      .evaluate((e) => getComputedStyle(e).animationName);
    expect(name).toBe('none');
  });

  test('PNG: se descarga con nombre seguro, a 2400 px y con contenido', async ({ page }) => {
    await openCurrent(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Descargar imagen/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`ramo-${key}.png`);
    const file = await download.path();
    const png = await readFile(file);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(2400);
    expect(png.readUInt32BE(20)).toBeGreaterThan(2400);
    expect(png.length).toBeGreaterThan(50_000);
    expect(png.length).toBeLessThan(15 * 1024 * 1024);
    await expect(page.getByRole('status').filter({ hasText: `ramo-${key}.png` })).toBeVisible();
  });
});
