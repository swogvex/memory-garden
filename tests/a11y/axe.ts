import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// Si axe mide a mitad de un fundido (p. ej. la hoja inferior al abrirse), ve colores intermedios y
// da contrastes falsos. Se espera a que acaben las animaciones y transiciones finitas; las infinitas
// (el balanceo de los adornos) no terminan nunca ni cambian el color, así que se ignoran. Límite: 5 s.
export async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    const done = Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 5000))]);
  });
}

// axe detecta solo una parte de los problemas de WCAG: no demuestra cumplimiento (se audita en H9).
export async function expectNoA11yViolations(page: Page): Promise<void> {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => ({
      target: n.target,
      why: n.any.map((c) => c.message),
      related: n.any.flatMap((c) => (c.relatedNodes ?? []).map((r) => r.target)),
    })),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}
