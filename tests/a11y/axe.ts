import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// axe detecta solo una parte de los problemas de WCAG: no demuestra cumplimiento (se audita en H9).
export async function expectNoA11yViolations(page: Page): Promise<void> {
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
