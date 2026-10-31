import { es } from '../../src/lib/i18n/es';
import { expectNoA11yViolations } from '../a11y/axe';
import { expect, test } from './fixtures';

/**
 * H8.4 · aviso de sin conexión. Con el navegador sin red (Playwright `setOffline`) aparece el aviso, accesible, y se va al
 * volver la conexión. Los mensajes de guardado según la causa los cubre `tests/unit/save-failure.test.ts`
 * (en `astro dev` los datos son locales y guardar no necesita red).
 */
test('sin conexión aparece el aviso y desaparece al volver; sin infracciones de axe', async ({
  page,
  context,
}) => {
  await page.goto('/jardin');
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 45_000 });
  const notice = page.getByText(es['shell.offline']);
  await expect(notice).toBeHidden();
  await context.setOffline(true);
  await expect(notice).toBeVisible();
  await expectNoA11yViolations(page);
  await context.setOffline(false);
  await expect(notice).toBeHidden();
});
