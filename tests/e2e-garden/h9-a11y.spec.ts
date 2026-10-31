import type { Page } from '@playwright/test';
import { t } from '../../src/lib/i18n';
import { expectNoA11yViolations } from '../a11y/axe';
import { expect, test } from './fixtures';

/**
 * H9.2 · Regresión de la auditoría: la vista de un recuerdo con la confirmación de papelera abierta no deja una
 * región con desplazamiento a la que no se llega con el teclado (axe `scrollable-region-focusable`, WCAG 2.1.1).
 */
test.use({ timezoneId: 'Europe/Madrid', locale: 'es-ES' });

async function openMuseo(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00+02:00'));
  await page.goto('/jardin');
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 45_000 });
  await page.locator('button[data-iso="2026-10-12"]').click();
  // Desde 64 rem el día se abre en el panel lateral; por debajo, en la hoja inferior (un diálogo).
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  const container = wide
    ? page.getByRole('region', { name: /12 de octubre de 2026/i })
    : page.getByRole('dialog');
  await container.getByRole('button', { name: /Museo/ }).first().click();
  const view = page.getByRole('dialog').last();
  await expect(view).toBeVisible();
  return view;
}

for (const vp of [
  { width: 1280, height: 800 },
  { width: 1280, height: 560 },
  { width: 390, height: 700 },
])
  test(`recuerdo con la papelera abierta: el cuerpo se alcanza con el teclado si se desplaza (${vp.width}×${vp.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    const view = await openMuseo(page);
    const decor = () =>
      view
        .locator('.actions')
        .evaluate((el) => parseFloat(getComputedStyle(el, '::before').height));
    const before = await decor();
    await view.getByRole('button', { name: t('es', 'memory.view.trash') }).click();
    await expect(view.getByRole('group', { name: t('es', 'memory.trash.title') })).toBeVisible();
    const body = view.locator('.body');
    const state = await body.evaluate((el) => ({
      scrolls: el.scrollHeight > el.clientHeight + 1,
      tabindex: el.getAttribute('tabindex'),
    }));
    expect(state.tabindex, JSON.stringify(state)).toBe(state.scrolls ? '0' : null);
    expect(await decor(), 'el ramillete de la esquina no cambia de tamaño').toBeCloseTo(before, 0);
    await expectNoA11yViolations(page);
  });
