import { defineConfig, devices } from '@playwright/test';

const PREVIEW = 'http://127.0.0.1:4321'; // compilación real
const DEV = 'http://127.0.0.1:4322'; // `astro dev` con datos de prueba (D-123)

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: PREVIEW, trace: 'retain-on-failure' },
  projects: [
    // Estructura y producción: contra el build.
    { name: 'chromium', testDir: 'tests/e2e', use: { ...devices['Desktop Chrome'] } },
    // Cobertura parcial de Safari (D-121). No sustituye a las pruebas en el iPhone real.
    { name: 'webkit', testDir: 'tests/e2e', use: { ...devices['Desktop Safari'] } },
    // Datos de prueba del Jardín: contra `astro dev`.
    {
      name: 'garden-chromium',
      testDir: 'tests/e2e-garden',
      timeout: 60_000,
      expect: { timeout: 15_000 },
      use: { ...devices['Desktop Chrome'], baseURL: DEV },
    },
    {
      name: 'garden-webkit',
      testDir: 'tests/e2e-garden',
      timeout: 60_000,
      expect: { timeout: 15_000 },
      use: { ...devices['Desktop Safari'], baseURL: DEV },
    },
  ],
  webServer: [
    {
      // Prueba contra la compilación real (requiere `npm run build` antes).
      command: 'npm run preview -- --host 127.0.0.1 --port 4321',
      url: PREVIEW,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4322',
      url: DEV,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
