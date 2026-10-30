import { expect, test } from '@playwright/test';

/**
 * PS-58 (CSP real contra la compilación): la política llega, no hay `unsafe-inline`/`unsafe-eval`, la app arranca bajo ella
 * y no se produce NINGUNA violación ni petición a otro dominio. La cabecera de CSP (frame-ancestors, etc.) se comprueba
 * en producción con `scripts/check-headers.mjs`; aquí se valida la parte que Astro entrega en la <meta>.
 */
const PAGES = ['/', '/jardin', '/ramos', '/explorar', '/configuracion'];

for (const path of PAGES) {
  test(`${path}: la <meta> de CSP trae hashes sin unsafe-inline, y la página arranca sin violaciones ni dominios externos`, async ({
    page,
    baseURL,
  }) => {
    const problems: string[] = [];
    const external: string[] = [];
    page.on('console', (m) => {
      if (/content security policy|refused to (apply|execute|load|connect)/i.test(m.text()))
        problems.push(m.text().slice(0, 200));
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
    page.on('request', (r) => {
      if (
        !r.url().startsWith(baseURL ?? '') &&
        !r.url().startsWith('blob:') &&
        !r.url().startsWith('data:')
      )
        external.push(r.url());
    });
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        (window as unknown as { __csp: string[] }).__csp.push(
          `${e.violatedDirective} ${e.blockedURI}`.slice(0, 200),
        ),
      );
    });
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    const policies = await page
      .locator('meta[http-equiv="content-security-policy" i]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('content') ?? ''));
    expect(policies.length, 'Astro no ha puesto la <meta> de CSP').toBeGreaterThan(0);
    const csp = policies.join(' ; ');
    expect(csp).toMatch(/script-src[^;]*'sha256-/);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);

    const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect(violations).toEqual([]);
    expect(problems).toEqual([]);
    expect(external).toEqual([]);
  });
}
