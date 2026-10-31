import type { Locator, Page } from '@playwright/test';
import { t, type MessageKey } from '../../src/lib/i18n';
import { expectNoA11yViolations } from '../a11y/axe';
import { expect, test } from './fixtures';
import { badFile, jpegFiles } from './photo-files';

test.use({ timezoneId: 'Europe/Madrid', locale: 'es-ES' });

const tt = (key: MessageKey, params?: Record<string, string | number>) => t('es', key, params);
const day = (page: Page, iso: string) => page.locator(`button[data-iso="${iso}"]`);
const field = (dialog: Locator, key: MessageKey) => dialog.getByLabel(tt(key), { exact: true });
const addButton = (page: Page) => page.getByRole('button', { name: tt('garden.add'), exact: true });

async function open(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00+02:00'));
  await page.goto('/jardin');
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 45_000 }); // D-283: primera carga en frío
}
async function openForm(page: Page, iso: string) {
  await day(page, iso).click();
  await addButton(page).click();
  const dialog = page.getByRole('dialog', { name: tt('memory.new') });
  await expect(dialog).toBeVisible();
  return dialog;
}
const save = (dialog: Locator) => dialog.getByRole('button', { name: tt('memory.save') });

test('crear un recuerdo en un día vacío: valores por defecto, guardado y resultado visible', async ({
  page,
}) => {
  await open(page);
  const dialog = await openForm(page, '2026-10-06');
  await expect(field(dialog, 'memory.field.date')).toHaveValue('2026-10-06');
  await expect(field(dialog, 'memory.field.season')).toHaveValue('otono');
  await expect(dialog.getByRole('radio', { name: 'Girasol' })).toBeChecked();
  await expect(field(dialog, 'memory.field.title')).toBeFocused();

  await field(dialog, 'memory.field.title').fill('Paseo nuevo');
  await field(dialog, 'memory.field.text').fill('Un texto de prueba');
  await save(dialog).click();

  await expect(dialog).toBeHidden();
  await expect(day(page, '2026-10-06')).toHaveAttribute('aria-label', /1 recuerdo/);
  await expect(page.getByRole('status').filter({ hasText: tt('memory.saved') })).toBeVisible();
  await expect(
    page.getByRole('region', { name: /6 de octubre de 2026/i }).getByText('Paseo nuevo'),
  ).toBeVisible();
  await expect(addButton(page)).toBeFocused();
});

test('la flor sigue a la categoría hasta que la eliges tú; la temporada sigue a la fecha', async ({
  page,
}) => {
  await open(page);
  const dialog = await openForm(page, '2026-10-06');
  await field(dialog, 'memory.field.category').selectOption('Citas');
  await expect(dialog.getByRole('radio', { name: 'Rosa' })).toBeChecked();
  await dialog.locator('label.flower', { hasText: 'Dalia' }).click();
  await field(dialog, 'memory.field.category').selectOption('Viajes');
  await expect(dialog.getByRole('radio', { name: 'Dalia' })).toBeChecked();
  await field(dialog, 'memory.field.date').fill('2026-01-15');
  await expect(field(dialog, 'memory.field.season')).toHaveValue('invierno');
});

test('validación: los errores salen junto a su campo y no se guarda nada', async ({ page }) => {
  await open(page);
  const dialog = await openForm(page, '2026-10-06');
  await save(dialog).click();
  const title = field(dialog, 'memory.field.title');
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toHaveAttribute('aria-describedby', /title-err/);
  await expect(dialog.getByText(tt('memory.error.title.required'))).toBeVisible();
  await expect(title).toBeFocused();

  await title.fill('Con enlace malo');
  await field(dialog, 'memory.field.link').fill('javascript:alert(1)');
  await save(dialog).click();
  await expect(dialog.getByText(tt('memory.error.link.invalid'))).toBeVisible();
  await expect(dialog).toBeVisible();

  await field(dialog, 'memory.field.link').fill('https://ejemplo.com/a');
  await save(dialog).click();
  await expect(dialog).toBeHidden();
});

test('un título con <script> se guarda y se muestra como texto', async ({ page }) => {
  await open(page);
  const dialog = await openForm(page, '2026-10-06');
  await field(dialog, 'memory.field.title').fill('<script>alert(2)</script>');
  await save(dialog).click();
  const panel = page.getByRole('region', { name: /6 de octubre de 2026/i });
  await expect(panel.getByText('<script>alert(2)</script>')).toBeVisible();
  expect(await panel.locator('script').count()).toBe(0);
});

test('cambios sin guardar: Escape pide confirmación; seguir editando y descartar', async ({
  page,
}) => {
  await open(page);
  const dialog = await openForm(page, '2026-10-06');
  await field(dialog, 'memory.field.title').fill('Borrador');
  const group = dialog.getByRole('group', { name: tt('memory.discard.title') });

  await page.keyboard.press('Escape');
  await expect(group).toBeVisible();
  await expect(dialog.getByRole('button', { name: tt('memory.discard.keep') })).toBeFocused();
  await page.keyboard.press('Escape'); // segundo Escape = seguir editando
  await expect(group).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(field(dialog, 'memory.field.title')).toHaveValue('Borrador');

  await dialog.getByRole('button', { name: tt('memory.cancel') }).click();
  await expect(group).toBeVisible();
  await dialog.getByRole('button', { name: tt('memory.discard.confirm') }).click();
  await expect(dialog).toBeHidden();
  await expect(day(page, '2026-10-06')).toHaveAttribute('aria-label', /sin recuerdos/);
  await expect(addButton(page)).toBeFocused();
});

test('sin cambios, Escape cierra directamente', async ({ page }) => {
  await open(page);
  const dialog = await openForm(page, '2026-10-06');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('doble envío: solo se crea un recuerdo', async ({ page }) => {
  await open(page);
  const dialog = await openForm(page, '2026-10-06');
  await field(dialog, 'memory.field.title').fill('Una sola vez');
  await dialog.locator('form').evaluate((f: HTMLFormElement) => {
    f.requestSubmit();
    f.requestSubmit();
  });
  await expect(dialog).toBeHidden();
  await expect(day(page, '2026-10-06')).toHaveAttribute('aria-label', /, 1 recuerdo$/);
});

test('hasta 5 fotos: sexta rechazada, portada y guardado', async ({ page }) => {
  test.setTimeout(150_000);
  await open(page);
  const dialog = await openForm(page, '2026-10-06');
  const files = await jpegFiles(page, 6);
  await dialog.locator('input[type="file"]').setInputFiles(files);
  const count = dialog.locator('p.count');
  await expect(count).toHaveText(tt('memory.photos.count', { count: 5, max: 5 }), {
    timeout: 90_000,
  });
  await expect(dialog.getByText(tt('memory.photos.limit'))).toBeVisible();
  await expect(dialog.getByRole('img')).toHaveCount(5);

  await dialog.getByLabel(tt('memory.photos.alt', { n: 3 })).fill('tercera');
  await dialog.getByRole('button', { name: tt('memory.photos.makeCover.label', { n: 3 }) }).click();
  await expect(dialog.getByLabel(tt('memory.photos.alt', { n: 1 }))).toHaveValue('tercera');
  await expect(dialog.getByText(tt('memory.photos.cover'), { exact: true })).toHaveCount(1);

  await dialog.getByRole('button', { name: tt('memory.photos.remove.label', { n: 5 }) }).click();
  await expect(count).toHaveText(tt('memory.photos.count', { count: 4, max: 5 }));

  await field(dialog, 'memory.field.title').fill('Con fotos');
  await save(dialog).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(day(page, '2026-10-06')).toHaveAttribute('aria-label', /, 1 recuerdo$/);
});

test('un fallo a mitad de la tanda no pierde el texto ni las demás fotos', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const dialog = await openForm(page, '2026-10-06');
  await field(dialog, 'memory.field.title').fill('No me pierdas');
  await field(dialog, 'memory.field.text').fill('Texto que debe quedarse');
  const [a, b] = await jpegFiles(page, 2);
  await dialog.locator('input[type="file"]').setInputFiles([a!, badFile, b!]);
  await expect(dialog.locator('p.count')).toHaveText(
    tt('memory.photos.count', { count: 2, max: 5 }),
    { timeout: 60_000 },
  );
  await expect(dialog.getByRole('alert').filter({ hasText: 'falsa.jpg' })).toContainText(
    tt('photo.error.format'),
  );
  await expect(field(dialog, 'memory.field.title')).toHaveValue('No me pierdas');
  await expect(field(dialog, 'memory.field.text')).toHaveValue('Texto que debe quedarse');
});

test('el formulario no tiene infracciones de accesibilidad (axe)', async ({ page }) => {
  await open(page);
  const dialog = await openForm(page, '2026-10-06');
  const [a] = await jpegFiles(page, 1);
  await dialog.locator('input[type="file"]').setInputFiles(a!);
  await expect(dialog.getByRole('img')).toHaveCount(1, { timeout: 60_000 });
  await expectNoA11yViolations(page);
});

test.describe('móvil (390 px)', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('pantalla completa, botones visibles, sin desbordamiento y guardado desde la hoja', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await open(page);
    await day(page, '2026-10-06').click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: tt('garden.add'), exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: tt('memory.new') });
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(389);
    expect(box!.height).toBeGreaterThanOrEqual(790);
    const sb = await save(dialog).boundingBox();
    expect(sb!.y + sb!.height).toBeLessThanOrEqual(800);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Con fotos, el cuerpo del formulario no se desborda en horizontal (antes de guardar: después el diálogo ya no existe).
    const files = await jpegFiles(page, 2);
    await dialog.locator('input[type="file"]').setInputFiles(files);
    await expect(dialog.locator('p.count')).toHaveText(
      tt('memory.photos.count', { count: 2, max: 5 }),
      { timeout: 60_000 },
    );
    const spill = await dialog.locator('.body').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(spill).toBeLessThanOrEqual(0);

    await field(dialog, 'memory.field.title').fill('Paseo móvil');
    await save(dialog).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('dialog').getByText('Paseo móvil')).toBeVisible();
  });
});
