import type { Page } from '@playwright/test';
import { t } from '../../src/lib/i18n';
import { expectNoA11yViolations } from '../a11y/axe';
import { expect, test } from './fixtures';

test.use({ timezoneId: 'Europe/Madrid', locale: 'es-ES' });

async function open(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00+02:00'));
  await page.goto('/jardin');
  await expect(page.getByRole('grid')).toBeVisible();
}
const day = (page: Page, iso: string) => page.locator(`button[data-iso="${iso}"]`);
const title = (page: Page) => page.getByRole('heading', { level: 1 });
const chip = (page: Page, name: RegExp) => page.getByRole('group').getByRole('button', { name });
const next = (page: Page) => page.getByRole('button', { name: t('es', 'garden.nav.next') });
const prev = (page: Page) => page.getByRole('button', { name: t('es', 'garden.nav.prev') });

test('cuadrícula: semántica, 7 columnas, días con nombre accesible y un solo día tabulable', async ({
  page,
}) => {
  await open(page);
  const grid = page.getByRole('grid', { name: /octubre de 2026/i });
  await expect(grid.getByRole('columnheader')).toHaveCount(7);
  await expect(grid.getByRole('columnheader').first()).toHaveText(/lunes/i);
  await expect(page.locator('button[data-iso]')).toHaveCount(31);
  const names = await page
    .locator('button[data-iso]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  for (const n of names) expect(n).toMatch(/, (sin recuerdos|1 recuerdo|\d+ recuerdos)$/);

  await expect(page.locator('button[data-iso][tabindex="0"]')).toHaveCount(1);
  const today = day(page, '2026-10-20');
  await expect(today).toHaveAttribute('tabindex', '0');
  await expect(today).toHaveAttribute('aria-current', 'date');
  await expect(today).toHaveAttribute('aria-label', /martes, 20 de octubre de 2026, 2 recuerdos/);
  await expectNoA11yViolations(page);
});

test('varios recuerdos en un día: foto de portada y contador +N', async ({ page }) => {
  await open(page);
  const d12 = day(page, '2026-10-12');
  await expect(d12).toHaveAttribute('aria-label', /lunes, 12 de octubre de 2026, 3 recuerdos/);
  await expect(d12.locator('.plus')).toHaveText('+2');
  await expect(day(page, '2026-10-05').locator('.plus')).toHaveCount(0);
  await expect(day(page, '2026-10-05').locator('.polaroid')).toHaveCount(1);
  await expect(day(page, '2026-10-06').locator('.polaroid')).toHaveCount(0);
});

test('31 de diciembre y 1 de enero caen en su día (2025/2026)', async ({ page }) => {
  await open(page);
  await chip(page, /^enero de 2026/i).click();
  await expect(title(page)).toHaveText(/enero de 2026/i);
  await expect(day(page, '2026-01-01')).toHaveAttribute(
    'aria-label',
    /jueves, 1 de enero de 2026, 1 recuerdo/,
  );
  await prev(page).click();
  await expect(title(page)).toHaveText(/diciembre de 2025/i);
  await expect(day(page, '2025-12-31')).toHaveAttribute(
    'aria-label',
    /miércoles, 31 de diciembre de 2025, 1 recuerdo/,
  );
  // El 1 de enero se ve atenuado como relleno, pero no es un día de diciembre.
  await expect(day(page, '2026-01-01')).toHaveCount(0);
});

test('31 de diciembre y 1 de enero caen en su día (2026/2027)', async ({ page }) => {
  await open(page);
  await chip(page, /^diciembre de 2026/i).click();
  await expect(day(page, '2026-12-31')).toHaveAttribute(
    'aria-label',
    /jueves, 31 de diciembre de 2026, 1 recuerdo/,
  );
  await next(page).click();
  await expect(title(page)).toHaveText(/enero de 2027/i);
  await expect(day(page, '2027-01-01')).toHaveAttribute(
    'aria-label',
    /viernes, 1 de enero de 2027, 1 recuerdo/,
  );
  await expect(day(page, '2026-12-31')).toHaveCount(0);
});

test('mes anterior, siguiente, chips, mes vacío y mes denso', async ({ page }) => {
  await open(page);
  await next(page).click();
  await expect(title(page)).toHaveText(/noviembre de 2026/i);
  await prev(page).click();
  await prev(page).click();
  await expect(title(page)).toHaveText(/septiembre de 2026/i);

  await chip(page, /^marzo de 2026/i).click();
  await expect(page.getByText(t('es', 'garden.empty'))).toBeVisible();
  await expect(page.locator('button[data-iso] .polaroid')).toHaveCount(0);
  await expectNoA11yViolations(page);

  await chip(page, /^mayo de 2026/i).click();
  await expect(page.getByText(t('es', 'garden.count.many', { count: 31 }))).toBeVisible();
  await expect(page.locator('button[data-iso] .polaroid')).toHaveCount(31);
  await expectNoA11yViolations(page);
});

test('teclado: flechas, Inicio/Fin, cambio de mes y un solo día tabulable', async ({ page }) => {
  await open(page);
  await day(page, '2026-10-20').focus();
  await page.keyboard.press('ArrowRight');
  await expect(day(page, '2026-10-21')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(day(page, '2026-10-19')).toBeFocused();
  await page.keyboard.press('End');
  await expect(day(page, '2026-10-25')).toBeFocused();
  await expect(page.locator('button[data-iso][tabindex="0"]')).toHaveCount(1);

  await page.keyboard.press('ArrowDown');
  await expect(title(page)).toHaveText(/noviembre de 2026/i);
  await expect(day(page, '2026-11-01')).toBeFocused();
  await page.keyboard.press('PageUp');
  await expect(title(page)).toHaveText(/octubre de 2026/i);
  await expect(day(page, '2026-10-01')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(day(page, '2026-10-01')).toHaveAttribute('aria-pressed', 'true');
});

test('escritorio: el día seleccionado se muestra en el panel lateral con «Añadir» desactivado', async ({
  page,
}) => {
  await open(page);
  await day(page, '2026-10-12').click();
  const panel = page.getByRole('region', { name: /12 de octubre de 2026/i });
  await expect(panel).toBeVisible();
  for (const text of ['Desayuno', 'Museo', 'Atardecer en la playa']) {
    await expect(panel.getByText(text)).toBeVisible();
  }
  await expect(panel.getByRole('button', { name: t('es', 'garden.add') })).toBeEnabled();
  await expect(panel.getByText(/Disponible pronto/)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectNoA11yViolations(page);
});

test('escritorio: recuerdo destacado, «Este mes», recientes y acceso al ramo', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('heading', { name: t('es', 'garden.aside.featured') })).toBeVisible();
  await expect(page.getByRole('button', { name: /Halloween/ })).toBeVisible();
  await expect(page.getByText(t('es', 'garden.aside.stat.memories', { count: 17 }))).toBeVisible();
  await page.getByRole('link', { name: t('es', 'garden.aside.bouquet') }).click();
  await expect(page).toHaveURL(/\/ramos\/?$/);
});

test('recientes: abrir uno navega a su mes y lo selecciona', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Primero de marzo/ }).click();
  await expect(title(page)).toHaveText(/marzo de 2028/i);
  await expect(day(page, '2028-03-01')).toHaveAttribute('aria-pressed', 'true');
});

test('prefers-reduced-motion: sin animación al cambiar de mes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await next(page).click();
  const seconds = await page
    .locator('table.grid')
    .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
  expect(seconds).toBeLessThan(0.01);
});

test.describe('móvil (390 px)', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('hoja inferior: se abre, es accesible, Escape la cierra y devuelve el foco', async ({
    page,
  }) => {
    await open(page);
    await day(page, '2026-10-12').click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { level: 2 })).toHaveText(/12 de octubre de 2026/i);
    await expect(sheet.getByText('Museo')).toBeVisible();
    await expect(sheet.getByRole('button', { name: t('es', 'garden.add') })).toBeEnabled();
    await expectNoA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(day(page, '2026-10-12')).toBeFocused();
  });

  test('el botón Cerrar también la cierra', async ({ page }) => {
    await open(page);
    await day(page, '2026-10-05').click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('es', 'garden.sheet.close') })
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(day(page, '2026-10-05')).toBeFocused();
  });

  test('gesto horizontal cambia de mes; el vertical no; los botones siguen funcionando', async ({
    page,
  }) => {
    await open(page);
    const swipe = (dx: number, dy: number) =>
      page.locator('.grid-wrap').evaluate(
        (el, [mx, my]) => {
          const ev = (type: string, x: number, y: number) =>
            new PointerEvent(type, { pointerType: 'touch', clientX: x, clientY: y, bubbles: true });
          el.dispatchEvent(ev('pointerdown', 200, 300));
          el.dispatchEvent(ev('pointerup', 200 + (mx ?? 0), 300 + (my ?? 0)));
        },
        [dx, dy],
      );
    await swipe(-120, 10);
    await expect(title(page)).toHaveText(/noviembre de 2026/i);
    await swipe(120, 10);
    await expect(title(page)).toHaveText(/octubre de 2026/i);
    await swipe(-80, 220);
    await expect(title(page)).toHaveText(/octubre de 2026/i);
    await swipe(-30, 0);
    await expect(title(page)).toHaveText(/octubre de 2026/i);
    await next(page).click();
    await expect(title(page)).toHaveText(/noviembre de 2026/i);
  });
});

test.describe('320 px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const month of ['octubre', 'mayo', 'marzo']) {
    test(`${month}: sin desbordamiento horizontal y objetivos táctiles`, async ({ page }) => {
      await open(page);
      if (month !== 'octubre') await chip(page, new RegExp(`^${month} de 2026`, 'i')).click();
      await expect(title(page)).toHaveText(new RegExp(`${month} de 2026`, 'i'));

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const gridBox = await page.locator('table.grid').boundingBox();
      expect(gridBox!.x + gridBox!.width).toBeLessThanOrEqual(320.5);

      // WCAG 2.2 AA exige 24 × 24; a 320 px un día mide ≈ 41 px de ancho (objetivo de 44 px solo en alto).
      const dayBox = await page.locator('button[data-iso]').first().boundingBox();
      expect(dayBox!.width).toBeGreaterThanOrEqual(24);
      expect(dayBox!.height).toBeGreaterThanOrEqual(44);
      for (const button of [prev(page), next(page)]) {
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      const chipBox = await chip(page, /^enero/i).boundingBox();
      expect(chipBox!.height).toBeGreaterThanOrEqual(44);
      await expectNoA11yViolations(page);
    });
  }
});
