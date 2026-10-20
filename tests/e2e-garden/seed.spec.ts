import { SEED_EXPECTED_COUNTS, SEED_MARKUP_TITLE } from '../../src/dev/seed-data';
import { t } from '../../src/lib/i18n';
import { expectNoA11yViolations } from '../a11y/axe';
import { expect, test } from './fixtures';

test.use({ timezoneId: 'Europe/Madrid', locale: 'es-ES' });

test('el jardín de desarrollo carga los recuerdos de prueba del mes actual', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00+02:00'));
  await page.goto('/jardin');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/octubre de 2026/i);
  const count = SEED_EXPECTED_COUNTS['2026-10']!;
  await expect(page.getByText(t('es', 'garden.count.many', { count }))).toBeVisible();

  // Un título con marcado se muestra como texto, sin crear elementos.
  await expect(page.getByText(SEED_MARKUP_TITLE)).toBeVisible();
  expect(await page.locator('main script').count()).toBe(0);

  await expectNoA11yViolations(page);
});

test('«hoy» usa la zona del dispositivo: a medianoche el mes cambia', async ({ browser }) => {
  // 2026-10-31T23:30Z es ya 1 de noviembre en Madrid (CET) y 31 de octubre en Los Ángeles.
  const instant = new Date('2026-10-31T23:30:00Z');
  for (const [timezoneId, heading] of [
    ['Europe/Madrid', /noviembre de 2026/i],
    ['America/Los_Angeles', /octubre de 2026/i],
  ] as const) {
    const context = await browser.newContext({ timezoneId, locale: 'es-ES' });
    const page = await context.newPage();
    await page.clock.setFixedTime(instant);
    await page.goto('http://127.0.0.1:4322/jardin');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await context.close();
  }
});
