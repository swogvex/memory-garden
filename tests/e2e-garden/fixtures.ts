import { test as base } from '@playwright/test';

/**
 * `astro dev` optimiza dependencias en la primera visita y puede recargar la página a mitad de una
 * prueba. Se calienta una vez por worker (visitando dos veces) para que las pruebas sean reproducibles.
 */
export const test = base.extend<object, { warmUp: void }>({
  warmUp: [
    async ({ browser }, use, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL;
      const context = await browser.newContext();
      const page = await context.newPage();
      for (let i = 0; i < 2; i++) {
        await page.goto(`${baseURL}/jardin`);
        await page.waitForLoadState('networkidle');
      }
      await context.close();
      await use();
    },
    { scope: 'worker', auto: true },
  ],
});
export { expect } from '@playwright/test';
