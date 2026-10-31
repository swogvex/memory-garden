import { expect, test } from './fixtures';

/**
 * D-266: El marco floral del acceso está en el HTML de todas las vistas (fuera de la isla).
 * Con la aplicación a la vista (aquí, datos de prueba sin acceso) tiene que ocultarse.
 */
test.use({ timezoneId: 'Europe/Madrid', locale: 'es-ES' });

// Primera carga: crea y cifra el espacio de prueba en el navegador (ver memory-lifecycle.spec.ts).
const FIRST_LOAD_TIMEOUT = 45_000;

test('con el Jardín a la vista el marco floral del acceso queda oculto', async ({ page }) => {
  await page.goto('/jardin');
  await expect(page.getByRole('grid')).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  await expect(page.locator('html')).toHaveAttribute('data-unlocked', '');
  await expect(page.locator('.ac-decor')).toHaveCount(1);
  await expect(page.locator('.ac-decor')).toBeHidden();
});
