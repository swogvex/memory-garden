import type { Locator, Page } from '@playwright/test';
import { t, type MessageKey } from '../../src/lib/i18n';
import { expectNoA11yViolations } from '../a11y/axe';
import { expect, test } from './fixtures';

/**
 * Papelera en Configuración (`astro dev`, espacio de pruebas en memoria). Se manda un recuerdo a la papelera
 * desde el Jardín y, sin recargar (los datos de prueba viven en memoria), se restaura o se borra para siempre.
 * La zona de peligro solo aparece con el acceso real: sus flujos los cubren `tests/unit/danger-flow.test.ts` y
 * `tests/unit/server/danger.test.ts`.
 */
test.use({ timezoneId: 'Europe/Madrid', locale: 'es-ES' });

const tt = (key: MessageKey, params?: Record<string, string | number>) => t('es', key, params);
const day = (page: Page, iso: string) => page.locator(`button[data-iso="${iso}"]`);
const trash = (page: Page): Locator =>
  page.locator('main#contenido').getByRole('region', { name: tt('settings.trash.title') });

async function trashedMemory(page: Page, title: string) {
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00+02:00'));
  await page.goto('/jardin');
  await expect(page.getByRole('grid')).toBeVisible();
  await day(page, '2026-10-06').click();
  await page.getByRole('button', { name: tt('garden.add'), exact: true }).click();
  const dialog = page.getByRole('dialog', { name: tt('memory.new') });
  await dialog.getByLabel(tt('memory.field.title'), { exact: true }).fill(title);
  await dialog.getByRole('button', { name: tt('memory.save') }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page
    .getByRole('region', { name: /6 de octubre de 2026/i })
    .getByRole('button', { name: new RegExp(title) })
    .click();
  const view = page.getByRole('dialog', { name: title });
  await view.getByRole('button', { name: tt('memory.view.trash') }).click();
  await view.getByRole('button', { name: tt('memory.trash.confirm') }).click();
  await expect(view).toBeHidden();
  // Navegación interna (sin recargar): el espacio de pruebas sigue en memoria.
  await page
    .getByRole('navigation', { name: tt('nav.label') })
    .getByRole('link', { name: tt('nav.settings') })
    .click();
  await expect(trash(page)).toBeVisible({ timeout: 30_000 });
  await expect(trash(page)).toContainText(title);
}

test('restaurar desde la papelera devuelve el recuerdo al Jardín (con axe)', async ({ page }) => {
  await trashedMemory(page, 'Vuelve del cubo');
  await expect(trash(page)).toContainText('Se borrará el 19 de noviembre de 2026');
  await expectNoA11yViolations(page);
  await trash(page)
    .getByRole('button', { name: tt('settings.trash.restore.label', { title: 'Vuelve del cubo' }) })
    .click();
  await expect(trash(page).getByRole('status').last()).toHaveText(tt('settings.trash.restored'));
  await expect(trash(page)).not.toContainText('Vuelve del cubo');
  await page
    .getByRole('navigation', { name: tt('nav.label') })
    .getByRole('link', { name: tt('nav.garden') })
    .click();
  await expect(day(page, '2026-10-06')).not.toHaveAttribute('aria-label', /sin recuerdos/);
});

test('borrar para siempre pide confirmación; cancelar no borra', async ({ page }) => {
  await trashedMemory(page, 'Adiós para siempre');
  const purge = trash(page).getByRole('button', {
    name: tt('settings.trash.purge.label', { title: 'Adiós para siempre' }),
  });
  await purge.click();
  await trash(page)
    .getByRole('button', { name: tt('security.cancel') })
    .click();
  await expect(trash(page)).toContainText('Adiós para siempre');
  await purge.click();
  await trash(page)
    .getByRole('button', { name: tt('settings.trash.purge.yes') })
    .click();
  await expect(trash(page).getByRole('status').last()).toHaveText(tt('settings.trash.purged'));
  await expect(trash(page)).not.toContainText('Adiós para siempre');
});
