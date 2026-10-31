import type { Locator, Page } from '@playwright/test';
import { t, type MessageKey } from '../../src/lib/i18n';
import { expectNoA11yViolations } from '../a11y/axe';
import { expect, test } from './fixtures';
import { jpegFiles } from './photo-files';

test.use({ timezoneId: 'Europe/Madrid', locale: 'es-ES' });

const tt = (key: MessageKey, params?: Record<string, string | number>) => t('es', key, params);
const day = (page: Page, iso: string) => page.locator(`button[data-iso="${iso}"]`);
const field = (dialog: Locator, key: MessageKey) => dialog.getByLabel(tt(key), { exact: true });
const addButton = (page: Page) => page.getByRole('button', { name: tt('garden.add'), exact: true });
const panelOf = (page: Page, text: RegExp) => page.getByRole('region', { name: text });

// La primera carga crea y cifra el espacio de prueba en el navegador (CPU). Con varios workers
// procesando fotos a la vez puede pasar de 15 s; lo que se prueba empieza después.
const FIRST_LOAD_TIMEOUT = 45_000;

async function open(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00+02:00'));
  await page.goto('/jardin');
  await expect(page.getByRole('grid')).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
}

async function createMemory(
  page: Page,
  iso: string,
  title: string,
  o: { photos?: number; text?: string; link?: string } = {},
) {
  await day(page, iso).click();
  await addButton(page).click();
  const dialog = page.getByRole('dialog', { name: tt('memory.new') });
  await field(dialog, 'memory.field.title').fill(title);
  if (o.text) await field(dialog, 'memory.field.text').fill(o.text);
  if (o.link) await field(dialog, 'memory.field.link').fill(o.link);
  if (o.photos) {
    await dialog.locator('input[type="file"]').setInputFiles(await jpegFiles(page, o.photos));
    await expect(dialog.locator('p.count')).toHaveText(
      tt('memory.photos.count', { count: o.photos, max: 5 }),
      { timeout: 90_000 },
    );
  }
  await dialog.getByRole('button', { name: tt('memory.save') }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

const openView = async (page: Page, panel: Locator, title: string) => {
  await panel.getByRole('button', { name: new RegExp(title) }).click();
  const view = page.getByRole('dialog', { name: title });
  await expect(view).toBeVisible();
  return view;
};

test('la portada de la cuadrícula es la foto real descifrada', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await createMemory(page, '2026-10-06', 'Con portada', { photos: 2 });
  const img = day(page, '2026-10-06').locator('.polaroid img');
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(day(page, '2026-10-07').locator('.polaroid')).toHaveCount(0);
});

test('consultar: texto como texto, enlace seguro y fotos con su alternativa', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await createMemory(page, '2026-10-06', 'Para ver', {
    photos: 2,
    text: 'Hola <script>alert(1)</script>\nsegunda línea',
    link: 'https://ejemplo.com/a',
  });
  const view = await openView(page, panelOf(page, /6 de octubre de 2026/i), 'Para ver');
  await expect(view.getByText('Hola <script>alert(1)</script>')).toBeVisible();
  expect(await view.locator('script').count()).toBe(0);
  const link = view.getByRole('link', { name: tt('memory.view.link') });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('href', 'https://ejemplo.com/a');
  await expect(view.getByRole('img')).toHaveCount(2, { timeout: 30_000 });
  await expectNoA11yViolations(page);
  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
  await expect(
    panelOf(page, /6 de octubre de 2026/i).getByRole('button', { name: /Para ver/ }),
  ).toBeFocused();
});

test('editar: cambia el título, quita una foto y reordena', async ({ page }) => {
  test.setTimeout(150_000);
  await open(page);
  await createMemory(page, '2026-10-06', 'Original', { photos: 2 });
  const panel = panelOf(page, /6 de octubre de 2026/i);
  const view = await openView(page, panel, 'Original');
  await view.getByRole('button', { name: tt('memory.view.edit') }).click();
  const form = page.getByRole('dialog', { name: tt('memory.edit') });
  await expect(form).toBeVisible();
  await expect(field(form, 'memory.field.title')).toHaveValue('Original');
  await expect(form.locator('p.count')).toHaveText(tt('memory.photos.count', { count: 2, max: 5 }));
  await expect(form.getByRole('img')).toHaveCount(2, { timeout: 30_000 });

  await field(form, 'memory.field.title').fill('Editado');
  await form.getByRole('button', { name: tt('memory.photos.remove.label', { n: 2 }) }).click();
  await expect(form.locator('p.count')).toHaveText(tt('memory.photos.count', { count: 1, max: 5 }));
  await form.getByRole('button', { name: tt('memory.save') }).click();
  await expect(form).toBeHidden({ timeout: 30_000 });

  await expect(page.getByRole('status').filter({ hasText: tt('memory.updated') })).toBeVisible();
  await expect(panel.getByText('Editado')).toBeVisible();
  const again = await openView(page, panel, 'Editado');
  await expect(again.getByRole('img')).toHaveCount(1, { timeout: 30_000 });
});

test('editar sin cambios y cancelar no pide confirmación', async ({ page }) => {
  await open(page);
  await createMemory(page, '2026-10-06', 'Sin tocar');
  const panel = panelOf(page, /6 de octubre de 2026/i);
  const view = await openView(page, panel, 'Sin tocar');
  await view.getByRole('button', { name: tt('memory.view.edit') }).click();
  const form = page.getByRole('dialog', { name: tt('memory.edit') });
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();
});

test('papelera: confirmar, conservar con Escape y mover', async ({ page }) => {
  await open(page);
  await createMemory(page, '2026-10-06', 'A la papelera');
  const panel = panelOf(page, /6 de octubre de 2026/i);
  const view = await openView(page, panel, 'A la papelera');
  await view.getByRole('button', { name: tt('memory.view.trash') }).click();
  const group = view.getByRole('group', { name: tt('memory.trash.title') });
  await expect(group).toBeVisible();
  await expect(group.getByText(tt('memory.trash.body'))).toBeVisible();
  await expect(view.getByRole('button', { name: tt('memory.trash.keep') })).toBeFocused();
  await page.keyboard.press('Escape'); // conservar
  await expect(group).toBeHidden();
  await expect(view).toBeVisible();

  await view.getByRole('button', { name: tt('memory.view.trash') }).click();
  await view.getByRole('button', { name: tt('memory.trash.confirm') }).click();
  await expect(view).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: tt('memory.trashed') })).toBeVisible();
  await expect(day(page, '2026-10-06')).toHaveAttribute('aria-label', /sin recuerdos/);
  await expect(day(page, '2026-10-06')).toBeFocused();
});

test('los recuerdos de la semilla (fotos ficticias) se ven como «no disponible» y se pueden editar', async ({
  page,
}) => {
  await open(page);
  await day(page, '2026-10-12').click();
  const panel = panelOf(page, /12 de octubre de 2026/i);
  const view = await openView(page, panel, 'Museo');
  await expect(view.getByRole('img', { name: tt('memory.photo.unavailable') })).toHaveCount(3, {
    timeout: 30_000,
  });
  await view.getByRole('button', { name: tt('memory.view.edit') }).click();
  const form = page.getByRole('dialog', { name: tt('memory.edit') });
  await field(form, 'memory.field.title').fill('Museo editado');
  await form.getByRole('button', { name: tt('memory.save') }).click();
  await expect(form).toBeHidden({ timeout: 30_000 });
  await expect(panel.getByText('Museo editado')).toBeVisible();
});

test.describe('móvil (390 px)', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('abrir desde la hoja inferior y volver con el foco en su sitio', async ({ page }) => {
    await open(page);
    await day(page, '2026-10-05').click();
    const sheet = page.getByRole('dialog', { name: /5 de octubre de 2026/i });
    const row = sheet.getByRole('button', { name: /Cena en casa/ });
    await row.click();
    const view = page.getByRole('dialog', { name: 'Cena en casa' });
    await expect(view).toBeVisible();
    const box = await view.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(389);
    await page.keyboard.press('Escape');
    await expect(view).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(row).toBeFocused();
  });
});
