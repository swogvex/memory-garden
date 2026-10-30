import { expect, test, type Page } from '@playwright/test';

/**
 * Pantalla de acceso (H7.3b) contra la compilación de producción, con la API simulada (`page.route`).
 * No hay criptografía real aquí (eso lo cubren las pruebas unitarias contra el servidor real): se comprueba
 * qué pantalla aparece en cada estado del servidor, los mensajes genéricos y la espera tras el 429.
 */
const KDF = '{"v":1,"alg":"pbkdf2-sha256","iter":1500000,"salt":"AAAAAAAAAAAAAAAAAAAAAA"}';
const REC_SALT = 'AAAAAAAAAAAAAAAAAAAAAA';

/** Respuesta de `/api/auth/params` para un espacio ya creado (el cliente exige `rec_salt`). */
const configured = (kdf: string = KDF) => ({ configured: true, kdf, rec_salt: REC_SALT });

/** «Mostrar contraseña» también contiene la palabra: sin `exact` el localizador coincide con dos elementos. */
const passwordField = (page: Page) => page.getByLabel('Contraseña', { exact: true });

async function mockParams(page: Page, body: Record<string, unknown> | number): Promise<void> {
  await page.route('**/api/auth/params', (route) =>
    typeof body === 'number'
      ? route.fulfill({ status: body, contentType: 'application/json', body: '{}' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

test('sin espacio creado: aparece el asistente de primer acceso, no el jardín', async ({
  page,
}) => {
  await mockParams(page, { configured: false });
  await page.goto('/jardin');
  await expect(
    page.getByRole('heading', { name: 'Cómo cuida Memory Garden tus recuerdos' }),
  ).toBeVisible();
});

test('con espacio creado: aparece "Entrar" y el campo de contraseña es de tipo password', async ({
  page,
}) => {
  await mockParams(page, configured());
  await page.goto('/jardin');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(passwordField(page)).toHaveAttribute('type', 'password');
});

test('si el servidor no responde: estado "No se pudo conectar" con reintento', async ({ page }) => {
  await mockParams(page, 500);
  await page.goto('/jardin');
  await expect(page.getByRole('heading', { name: 'No se pudo conectar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('parámetros de KDF peligrosos: se aborta antes de enviar nada al servidor', async ({
  page,
}) => {
  const weak = '{"v":1,"alg":"pbkdf2-sha256","iter":1000,"salt":"AAAAAAAAAAAAAAAAAAAAAA"}';
  await mockParams(page, configured(weak));
  let loginCalls = 0;
  await page.route('**/api/auth/login', (route) => {
    loginCalls += 1;
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"error":"invalid_credentials"}',
    });
  });
  await page.goto('/jardin');
  await passwordField(page).fill('una contraseña cualquiera 2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(loginCalls, 'no debe llegar ninguna petición de login con parámetros inseguros').toBe(0);
});

test('429: muestra una espera con cuenta atrás y deshabilita el botón', async ({ page }) => {
  await mockParams(page, configured());
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 429,
      headers: { 'Retry-After': '30' },
      contentType: 'application/json',
      body: '{"error":"rate_limited","retry_after":30}',
    }),
  );
  await page.goto('/jardin');
  await passwordField(page).fill('una contraseña cualquiera 2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /Reintentar en \d+ s/ })).toBeDisabled({
    timeout: 15_000,
  });
});

test('la contraseña no queda en la URL ni en el almacenamiento del navegador', async ({ page }) => {
  await mockParams(page, configured());
  await page.goto('/jardin');
  const secret = 'contraseña-secreta-de-prueba-2026';
  await passwordField(page).fill(secret);
  expect(page.url()).not.toContain(secret);
  const stored = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  );
  expect(stored).not.toContain(secret);
});
