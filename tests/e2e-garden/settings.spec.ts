import type { Page } from '@playwright/test';
import { en } from '../../src/lib/i18n/en';
import { es } from '../../src/lib/i18n/es';
import { expectNoA11yViolations } from '../a11y/axe';
import { expect, test } from './fixtures';

/**
 * Configuración con el espacio de pruebas (`astro dev`, datos cifrados en memoria; se pierden al recargar).
 * Cubre perfil, avatar floral, idioma, categorías y la página de privacidad, más axe con todo abierto.
 */
const main = (page: Page) => page.locator('main#contenido');
const section = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });

async function openSettings(page: Page) {
  await page.goto('/configuracion');
  await expect(section(page, es['settings.profile.title'])).toBeVisible({ timeout: 45_000 });
}

test('muestra perfil, avatar, preferencias, categorías y privacidad, sin infracciones de axe', async ({
  page,
}) => {
  await openSettings(page);
  for (const title of [
    es['settings.avatar.title'],
    es['settings.prefs.title'],
    es['settings.categories.title'],
    es['privacy.title'],
  ])
    await expect(section(page, title)).toBeVisible();
  // Categorías de serie (D-135).
  for (const name of ['Viajes', 'Momentos', 'Naturaleza', 'Citas'])
    await expect(
      main(page).getByRole('button', { name: `Editar la categoría ${name}` }),
    ).toBeVisible();
  await expectNoA11yViolations(page);
});

test('el nombre y el mensaje de bienvenida aparecen en la cabecera del Jardín', async ({
  page,
}) => {
  await openSettings(page);
  const profile = section(page, es['settings.profile.title']);
  await profile.getByLabel(es['settings.profile.name']).fill('Ana');
  await profile.getByLabel(es['settings.profile.welcome']).fill('Bienvenida a <b>casa</b>');
  await profile.getByRole('button', { name: es['settings.profile.save'] }).click();
  await expect(profile.getByRole('status')).toHaveText(es['settings.saved']);

  await page
    .getByRole('navigation', { name: es['nav.label'] })
    .getByRole('link', { name: es['nav.garden'], exact: true })
    .press('Enter');
  await expect(page.locator('.eyebrow')).toContainText('El jardín de Ana');
  // El texto del usuario se muestra como texto, nunca como HTML.
  await expect(page.locator('.subtitle')).toHaveText('Bienvenida a <b>casa</b>');
  await expect(page.locator('.subtitle b')).toHaveCount(0);
});

test('nombre demasiado largo: error junto al campo y no se guarda', async ({ page }) => {
  await openSettings(page);
  const profile = section(page, es['settings.profile.title']);
  const name = profile.getByLabel(es['settings.profile.name']);
  // `maxlength` impide escribir más; se fuerza el valor para comprobar la validación propia.
  await name.evaluate((el: HTMLInputElement) => {
    el.removeAttribute('maxlength');
  });
  await name.fill('x'.repeat(61));
  await profile.getByRole('button', { name: es['settings.profile.save'] }).click();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(profile.getByRole('status')).toHaveText('');
});

test('avatar floral: se marca el elegido y la cabecera cambia', async ({ page }) => {
  await openSettings(page);
  const avatar = section(page, es['settings.avatar.title']);
  const tulip = avatar.getByRole('button', { name: 'Avatar de Tulipán' });
  await tulip.click();
  await expect(avatar.getByRole('status')).toHaveText(es['settings.avatar.saved']);
  await expect(tulip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: es['shell.avatar'] }).locator('use')).toHaveCount(1);
  await avatar.getByRole('button', { name: es['settings.avatar.remove'] }).click();
  await expect(tulip).toHaveAttribute('aria-pressed', 'false');
  await expect(avatar.getByRole('button', { name: es['settings.avatar.upload'] })).toBeFocused();
});

test('cambiar a inglés cambia toda la interfaz y lo recuerda para la pantalla de acceso', async ({
  page,
}) => {
  await openSettings(page);
  const prefsCard = section(page, es['settings.prefs.title']);
  await prefsCard.getByRole('radio', { name: 'English' }).check();
  await prefsCard.getByRole('button', { name: es['settings.prefs.save'] }).click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const navEn = page.getByRole('navigation', { name: en['nav.label']! });
  for (const key of ['nav.garden', 'nav.bouquets', 'nav.explore', 'nav.settings'] as const)
    await expect(navEn.getByRole('link', { name: en[key]!, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['nav.settings']!);
  await expect(section(page, en['privacy.title']!)).toBeVisible();
  await expect(page).toHaveTitle(`${en['nav.settings']} · Memory Garden`);
  expect(await page.evaluate(() => window.localStorage.getItem('mg.lang'))).toBe('en');
  await expectNoA11yViolations(page);

  // Y de vuelta al español.
  const prefsEn = section(page, en['settings.prefs.title']!);
  await prefsEn.getByRole('radio', { name: 'Español' }).check();
  await prefsEn.getByRole('button', { name: en['settings.prefs.save']! }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(es['nav.settings']);
});

test('categorías: añadir, rechazar repetidas, renombrar y eliminar moviendo sus recuerdos', async ({
  page,
}) => {
  await openSettings(page);
  const cats = section(page, es['settings.categories.title']);
  const status = cats.getByRole('status').last();

  // Añadir.
  await cats.getByLabel(es['settings.categories.name']).fill('Familia');
  await cats.getByRole('button', { name: es['settings.categories.add'] }).click();
  await expect(status).toHaveText(es['settings.categories.added']);
  await expect(cats.getByRole('button', { name: 'Editar la categoría Familia' })).toBeVisible();

  // Repetida (sin distinguir mayúsculas): error asociado al campo.
  const newName = cats.getByLabel(es['settings.categories.name']);
  await newName.fill('  familia ');
  await cats.getByRole('button', { name: es['settings.categories.add'] }).click();
  await expect(newName).toHaveAttribute('aria-invalid', 'true');
  await expect(cats.getByText(es['settings.categories.error.duplicate'])).toBeVisible();

  // Renombrar una categoría con recuerdos (la semilla usa «Viajes»).
  await cats.getByRole('button', { name: 'Editar la categoría Viajes' }).click();
  const editName = cats.locator('form.st-panel').first().getByLabel(es['settings.categories.name']);
  await expect(editName).toBeFocused();
  await editName.fill('Escapadas');
  await cats.getByRole('button', { name: es['settings.categories.save'], exact: true }).click();
  await expect(status).toHaveText(es['settings.categories.renamed'], { timeout: 45_000 });
  await expect(cats.getByRole('button', { name: 'Editar la categoría Escapadas' })).toBeFocused();

  // Eliminar «Escapadas» moviendo sus recuerdos a «Momentos».
  await cats.getByRole('button', { name: 'Eliminar la categoría Escapadas' }).click();
  await expect(cats.getByLabel(es['settings.categories.remove.target'])).toBeVisible();
  await cats.getByLabel(es['settings.categories.remove.target']).selectOption('Momentos');
  await cats
    .getByRole('button', {
      name: es['settings.categories.remove.confirm'],
      exact: true,
    })
    .click();
  await expect(status).toHaveText(es['settings.categories.removed'], { timeout: 45_000 });
  await expect(cats.getByRole('button', { name: 'Editar la categoría Escapadas' })).toHaveCount(0);
});

test('privacidad: explica cookies, almacenamiento local, qué ve el servidor y la pérdida de claves', async ({
  page,
}) => {
  await openSettings(page);
  const privacy = section(page, es['privacy.title']);
  for (const key of [
    'privacy.cookies.title',
    'privacy.server.title',
    'privacy.keys.title',
    'privacy.png.title',
  ] as const)
    await expect(privacy.getByRole('heading', { level: 3, name: es[key] })).toBeVisible();
  await expect(privacy).toContainText('(es o en)');
});

test('móvil (320 y 390 px): sin desbordamiento horizontal y la barra inferior sigue visible al volver arriba', async ({
  page,
}) => {
  await openSettings(page);
  const prefsCard = section(page, es['settings.prefs.title']);
  await prefsCard.getByRole('radio', { name: es['settings.prefs.timeZone.manual'] }).check();
  await expect(prefsCard.getByLabel(es['settings.prefs.timeZone.select'])).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 740 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `desbordamiento a ${width} px`).toBeLessThanOrEqual(0);
    const bar = page.getByRole('navigation', { name: es['nav.label'] });
    // Abajo del todo y de vuelta arriba: la barra inferior queda dentro de la pantalla.
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      document.querySelector('.content')?.scrollTo(0, 1e6);
    });
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector('.content')?.scrollTo(0, 0);
    });
    const box = (await bar.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(740 + 1);
    expect(box.y).toBeGreaterThan(740 / 2);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  }
});

test('escritorio (1440 px): dos columnas que llegan hasta el avatar de la cabecera', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSettings(page);
  const profile = (await section(page, es['settings.profile.title']).boundingBox())!;
  const avatar = (await section(page, es['settings.avatar.title']).boundingBox())!;
  const privacy = (await section(page, es['privacy.title']).boundingBox())!;
  const headerAvatar = (await page.getByRole('link', { name: es['shell.avatar'] }).boundingBox())!;
  expect(Math.abs(profile.y - avatar.y)).toBeLessThanOrEqual(1); // misma fila
  expect(avatar.x).toBeGreaterThan(profile.x + profile.width);
  expect(privacy.width).toBeGreaterThan(profile.width * 1.9); // a lo ancho
  // El borde derecho del contenido queda alineado con el avatar de la cabecera (± 2 px).
  expect(
    Math.abs(avatar.x + avatar.width - (headerAvatar.x + headerAvatar.width)),
  ).toBeLessThanOrEqual(2);
});
