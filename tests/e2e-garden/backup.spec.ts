import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { es } from '../../src/lib/i18n/es';
import { expectNoA11yViolations } from '../a11y/axe';
import { expect, test } from './fixtures';

/**
 * Copia cifrada en la interfaz (`astro dev`, espacio de pruebas cifrado de verdad en memoria).
 * 1) Configuración → Tus datos exporta un `.mgx` real. 2) Con `?acceso` y la API simulada (`page.route`), el asistente
 * «Restaurar desde una copia» abre ESE archivo, pide clave nueva y código, y sube los sobres.
 * La ida y vuelta completa contra el Worker (mismos recuerdos y fotos) la cubre `tests/unit/backup-roundtrip.test.ts`.
 */
const DEV_PASSWORD = 'Contraseña-solo-de-pruebas-H4-jardín'; // src/dev/seed.ts: solo existe en desarrollo
const main = (page: Page) => page.locator('main#contenido');
const dataSection = (page: Page) =>
  main(page).getByRole('region', { name: es['settings.data.title'], exact: true });

async function exportFromSettings(page: Page): Promise<string> {
  await page.goto('/configuracion');
  await expect(dataSection(page)).toBeVisible({ timeout: 45_000 });
  const downloading = page.waitForEvent('download');
  await dataSection(page).getByRole('button', { name: es['settings.data.export'] }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^memory-garden-\d{4}-\d{2}-\d{2}\.mgx$/);
  const path = await download.path();
  return path;
}

interface Sent {
  method: string;
  path: string;
  body: string;
}

async function mockEmptyServer(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  let configured = false;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    sent.push({ method, path, body: req.postData() ?? '' });
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/params') return json(200, { configured, kdf: null, rec_salt: null });
    if (path === '/api/setup') {
      configured = true;
      return json(200, { vault_id: 'x', key_revision: 1 });
    }
    if (path === '/api/memories' && method === 'GET') return json(200, { items: [], next: null });
    if (path === '/api/vault/settings' && method === 'GET')
      return json(200, { payload: null, revision: 0 });
    if (path === '/api/vault/settings' && method === 'PUT') return json(200, { revision: 1 });
    if (path.startsWith('/api/assets/') && method === 'PUT')
      return json(201, { id: path.split('/').pop() });
    if (path.startsWith('/api/memories/') && method === 'PUT')
      return json(200, { id: 'x', revision: 1, created_at: 1, updated_at: 1 });
    return json(404, { error: 'not_found' });
  });
  return sent;
}

async function openRestore(page: Page) {
  await page.goto('/jardin?acceso');
  await page.getByRole('checkbox', { name: es['setup.privacy.read'] }).check();
  await page.getByRole('button', { name: es['restore.link'] }).click();
  await expect(page.getByRole('heading', { name: es['restore.title'] })).toBeVisible();
}

test('exportar: descarga un .mgx cifrado y resume lo que lleva, sin infracciones de axe', async ({
  page,
}) => {
  const path = await exportFromSettings(page);
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('MGX1');
  // Nada en claro: ni títulos de la semilla ni la contraseña de pruebas.
  const text = bytes.toString('utf8');
  expect(text).not.toContain('Contraseña-solo');
  expect(text).not.toContain('Viajes');
  await expect(dataSection(page).getByRole('status').first()).toContainText('Recuerdos:');
  // Las fotos de la semilla son ficticias (no existen): se avisa de que no van en la copia.
  await expect(dataSection(page)).toContainText(es['settings.data.missing'].split(':')[0]!);
  await expect(
    dataSection(page).getByRole('link', { name: es['settings.data.download'] }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test('restaurar la copia exportada: se abre en el navegador, pide clave nueva y código, y sube sin datos en claro', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const path = await exportFromSettings(page);
  const sent = await mockEmptyServer(page);
  await openRestore(page);
  await page.getByLabel(es['restore.file.label']).setInputFiles(path);
  await page.getByRole('button', { name: es['access.continue'] }).click();

  await expect(page.getByRole('heading', { name: es['restore.credential.title'] })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByLabel(es['login.password'], { exact: true }).fill('no es la contraseña');
  await page.getByRole('button', { name: es['access.continue'] }).click();
  await expect(page.getByRole('alert')).toHaveText(es['backup.error.credentials'], {
    timeout: 30_000,
  });
  const beyondParams = () => sent.filter((s) => s.path !== '/api/auth/params');
  expect(beyondParams()).toEqual([]); // abrir y comprobar la copia no envía nada

  await page.getByLabel(es['login.password'], { exact: true }).fill(DEV_PASSWORD);
  await page.getByRole('button', { name: es['access.continue'] }).click();
  await expect(page.getByRole('heading', { name: es['setup.key.title'] })).toBeVisible({
    timeout: 30_000,
  });
  expect(beyondParams()).toEqual([]);
  const key = (await page.locator('.ac-key span').allTextContents()).join('-');
  await page.getByRole('button', { name: es['access.continue'] }).click();
  await page.getByRole('textbox', { name: es['key.label'] }).fill(key);
  await page.getByRole('checkbox', { name: es['setup.verify.saved'] }).check();
  await page.getByRole('button', { name: es['access.continue'] }).click();

  await page.getByLabel(es['setup.code.label']).fill('ABCDE-FGHJK-MNPQR-STVWX-YZ012');
  await page.getByRole('button', { name: es['restore.submit'], exact: true }).click();
  await expect(page.getByRole('heading', { name: es['restore.done.title'] })).toBeVisible({
    timeout: 30_000,
  });

  const setup = sent.find((s) => s.path === '/api/setup');
  expect(setup).toBeDefined();
  expect(Object.keys(JSON.parse(setup!.body) as object).sort()).toEqual([
    'auth_pw',
    'auth_rec',
    'kdf',
    'mk_version',
    'rec_salt',
    'setup_code',
    'vault_id',
    'wrapped_mk_pw',
    'wrapped_mk_rec',
  ]);
  const memories = sent.filter((s) => s.method === 'PUT' && s.path.startsWith('/api/memories/'));
  expect(memories.length).toBeGreaterThan(0);
  for (const m of memories)
    expect(JSON.parse(m.body)).toMatchObject({ expected_revision: null, asset_ids: [] });
  const everything = sent.map((s) => s.body).join('\n');
  for (const secret of [DEV_PASSWORD, key, 'Viajes']) expect(everything).not.toContain(secret);
});

test('un archivo que no es una copia se rechaza al elegirlo, sin enviar nada', async ({ page }) => {
  const sent = await mockEmptyServer(page);
  const path = join(mkdtempSync(join(tmpdir(), 'mg-restore-')), 'foto.jpg');
  writeFileSync(path, 'no es una copia');
  await openRestore(page);
  await page.getByLabel(es['restore.file.label']).setInputFiles(path);
  await expect(page.getByRole('alert')).toHaveText(es['backup.error.format']);
  await expect(page.getByRole('button', { name: es['access.continue'] })).toBeDisabled();
  expect(sent.filter((s) => s.path !== '/api/auth/params')).toEqual([]);
});
