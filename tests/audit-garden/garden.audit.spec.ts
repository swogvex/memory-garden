import type { Page } from '@playwright/test';
import { t, type MessageKey } from '../../src/lib/i18n';
import { en } from '../../src/lib/i18n/en';
import { es } from '../../src/lib/i18n/es';
import {
  applyTextSpacing,
  auditState,
  clippedText,
  expectFocusStops,
  runningAnimations,
  tabTo,
  type FocusStop,
} from '../a11y/audit';
import { expect, test } from '../e2e-garden/fixtures';

/**
 * H9.1 · Auditoría de la app con sesión contra `astro dev` y la semilla (proyecto `audit-garden`).
 * Solo con `npm run test:audit`. Recorre pantallas y modales a varios anchos y tres flujos solo con teclado.
 * Chromium únicamente: el WebKit de Playwright no lleva el foco a los enlaces con Tab (D-121).
 */
test.use({ timezoneId: 'Europe/Madrid', locale: 'es-ES' });

const tt = (key: MessageKey, params?: Record<string, string | number>) => t('es', key, params);
const MONTH = '2026-10';
const day = (page: Page, iso: string) => page.locator(`button[data-iso="${iso}"]`);
const exact = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

async function go(page: Page, path: string) {
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00+02:00'));
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 45_000 });
  await page.waitForLoadState('networkidle');
}

const VIEWS = [
  { slug: 'jardin', label: es['nav.garden'] },
  { slug: 'ramos', label: es['nav.bouquets'] },
  { slug: 'explorar', label: es['nav.explore'] },
  { slug: 'configuracion', label: es['nav.settings'] },
];
const WIDTHS = [
  { label: '320', width: 320, height: 640 },
  { label: '390', width: 390, height: 844 },
  { label: 'zoom 200 %', width: 640, height: 400 },
  { label: '1280', width: 1280, height: 800 },
];

test.describe('auditoría · vistas', () => {
  for (const v of VIEWS)
    test(`${v.slug}: anchos y zoom`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w.width, height: w.height });
        await go(page, `/${v.slug}`);
        await auditState(page, testInfo, `${v.label} · ${w.label}`);
      }
    });

  test('jardín a 390 con espaciado de texto 1.4.12', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, '/jardin');
    await applyTextSpacing(page);
    const clipped = await clippedText(page);
    expect.soft(clipped, 'texto recortado con el espaciado de WCAG 1.4.12').toEqual([]);
    await auditState(page, testInfo, 'Jardín · espaciado de texto', { extra: { clipped } });
  });
});

test.describe('auditoría · paneles y modales', () => {
  test('jardín: panel del día, recuerdo, papelera, formulario y descartar', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await go(page, '/jardin');
    await day(page, '2026-10-12').click();
    const panel = page.getByRole('region', { name: /12 de octubre de 2026/i });
    await expect(panel).toBeVisible();
    await auditState(page, testInfo, 'Jardín · panel del día');

    await panel.getByRole('button', { name: /Museo/ }).first().click();
    const view = page.getByRole('dialog').last();
    await expect(view).toBeVisible();
    await auditState(page, testInfo, 'Recuerdo · consulta');
    await view.getByRole('button', { name: tt('memory.view.trash') }).click();
    await expect(view.getByRole('group', { name: tt('memory.trash.title') })).toBeVisible();
    await auditState(page, testInfo, 'Recuerdo · confirmar papelera');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(view).toBeHidden();

    await day(page, '2026-10-06').click();
    await page.getByRole('button', { name: tt('garden.add'), exact: true }).click();
    const form = page.getByRole('dialog', { name: tt('memory.new') });
    await expect(form).toBeVisible();
    await auditState(page, testInfo, 'Formulario · nuevo');
    await form.getByRole('button', { name: tt('memory.save') }).click();
    await auditState(page, testInfo, 'Formulario · errores de validación');
    await form.getByLabel(tt('memory.field.title'), { exact: true }).fill('Sin guardar');
    await page.keyboard.press('Escape');
    await expect(page.getByText(tt('memory.discard.title'))).toBeVisible();
    await auditState(page, testInfo, 'Formulario · descartar cambios');
  });

  test('jardín móvil: hoja inferior y formulario a pantalla completa', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, '/jardin');
    await day(page, '2026-10-12').click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await auditState(page, testInfo, 'Jardín · hoja inferior 390');
    await sheet.getByRole('button', { name: tt('garden.add'), exact: true }).click();
    await expect(page.getByRole('dialog', { name: tt('memory.new') })).toBeVisible();
    await auditState(page, testInfo, 'Formulario · 390');
  });

  test('ramos: detalle, flor abierta y PNG', async ({ page }, testInfo) => {
    for (const w of [WIDTHS[1]!, WIDTHS[3]!]) {
      await page.setViewportSize({ width: w.width, height: w.height });
      await go(page, '/ramos');
      await page.locator(`button[data-key="${MONTH}"]`).click();
      await expect(page.locator('.mg-fl').first()).toBeVisible();
      await auditState(page, testInfo, `Ramos · detalle ${w.label}`);
    }
    await page.locator('.mg-fl').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await auditState(page, testInfo, 'Ramos · recuerdo desde una flor');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: es['bouquets.back'] }).click();
    await expect(page.locator('button[data-key]')).toHaveCount(12);
  });

  test('configuración en inglés', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await go(page, '/configuracion');
    const prefs = page
      .locator('main#contenido')
      .getByRole('region', { name: es['settings.prefs.title'], exact: true });
    await prefs.getByRole('radio', { name: 'English' }).check();
    await prefs.getByRole('button', { name: es['settings.prefs.save'] }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['nav.settings']!);
    await auditState(page, testInfo, 'Configuración · inglés');
  });

  test('prefers-reduced-motion: Jardín y Ramos sin animaciones en marcha', async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await go(page, '/jardin');
    await page.waitForTimeout(500);
    const garden = await runningAnimations(page);
    expect.soft(garden, 'Jardín: animaciones con reduced-motion').toEqual([]);
    await go(page, '/ramos');
    await page.locator(`button[data-key="${MONTH}"]`).click();
    await expect(page.locator('.mg-fl').first()).toBeVisible();
    await page.waitForTimeout(500);
    const ramos = await runningAnimations(page);
    expect.soft(ramos, 'Ramos: animaciones con reduced-motion').toEqual([]);
    await auditState(page, testInfo, 'Ramos · reduced-motion', { extra: { garden, ramos } });
  });
});

test.describe('auditoría · solo teclado', () => {
  test.beforeEach(async ({ page }) => page.setViewportSize({ width: 1280, height: 800 }));

  test('crear un recuerdo solo con teclado', async ({ page }, testInfo) => {
    await go(page, '/jardin');
    const stops: FocusStop[] = [];
    stops.push(...(await tabTo(page, { selector: 'button[data-iso][tabindex="0"]' })));
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(day(page, '2026-10-06')).toBeFocused();
    await page.keyboard.press('Enter');
    stops.push(...(await tabTo(page, { name: exact(tt('garden.add')) })));
    await page.keyboard.press('Enter');
    const form = page.getByRole('dialog', { name: tt('memory.new') });
    await expect(form).toBeVisible();
    stops.push(
      ...(await tabTo(page, {
        selector: 'input',
        name: new RegExp(`^${tt('memory.field.title')}`),
      })),
    );
    await page.keyboard.type('Hecho con teclado');
    stops.push(...(await tabTo(page, { name: exact(tt('memory.save')) })));
    await page.keyboard.press('Enter');
    await expect(form).toBeHidden({ timeout: 30_000 });
    await expect(day(page, '2026-10-06')).toHaveAttribute('aria-label', /1 recuerdo/);
    expectFocusStops(stops, 'crear recuerdo');
    await auditState(page, testInfo, 'Teclado · recuerdo creado', { focusStops: stops });
  });

  test('abrir un ramo y una flor solo con teclado', async ({ page }, testInfo) => {
    await go(page, '/ramos');
    const stops: FocusStop[] = [];
    stops.push(...(await tabTo(page, { selector: `button[data-key="${MONTH}"]` })));
    await page.keyboard.press('Enter');
    await expect(page.locator('.mg-fl').first()).toBeVisible();
    stops.push(...(await tabTo(page, { selector: '.mg-fl' })));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.mg-fl:focus')).toHaveCount(1);
    expectFocusStops(stops, 'ramo');
    await auditState(page, testInfo, 'Teclado · ramo', { focusStops: stops });
  });

  test('cambiar el idioma solo con teclado', async ({ page }, testInfo) => {
    await go(page, '/configuracion');
    const stops: FocusStop[] = [];
    stops.push(...(await tabTo(page, { selector: 'input[type="radio"]', name: /^Español$/ }, 120)));
    await page.keyboard.press('ArrowDown');
    stops.push(...(await tabTo(page, { name: exact(es['settings.prefs.save']) })));
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expectFocusStops(stops, 'idioma');
    await auditState(page, testInfo, 'Teclado · idioma', { focusStops: stops });
  });
});
