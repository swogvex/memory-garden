import { readFile, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { settleAnimations } from './axe';

/**
 * Auditoría de accesibilidad (medición, no cumplimiento).
 *
 * Cada `auditState` registra un estado de la interfaz (pantalla, modal, ancho) en
 * `test-results/<prueba>/a11y-audit.json`; `npm run audit:summary` los junta en una tabla.
 * Reglas:
 *  - axe con WCAG 2.0–2.2 A/AA **y** `best-practice`, guardando TODAS las infracciones y su impacto.
 *  - Falla en duro solo con impacto `critical` (D-268). `serious` falla con `expect.soft`
 *    para que la pasada siga y se vea todo; `moderate`/`minor` solo se registran.
 *  - Objetivos táctiles: < 24 px (mínimo de WCAG 2.5.8) falla en blando; < 44 px (objetivo del proyecto) se registra.
 *  - Reflujo: desbordamiento horizontal del documento.
 * axe y estas comprobaciones automáticas NO demuestran WCAG 2.2 AA: falta la revisión manual y con lector de pantalla.
 */

interface AxeFinding {
  id: string;
  impact: string;
  help: string;
  targets: string[];
}
interface TargetFinding {
  name: string;
  selector: string;
  width: number;
  height: number;
}
export interface StateRecord {
  label: string;
  url: string;
  viewport: string;
  lang: string;
  axe: AxeFinding[];
  targetsUnder24: TargetFinding[];
  targetsUnder44: TargetFinding[];
  overflowPx: number;
  focusStops?: FocusStop[];
  extra?: Record<string, unknown>;
}
export interface FocusStop {
  name: string;
  tag: string;
  /** `true` si se detecta un aro; `'manual'` si no se puede detectar (SVG, fecha nativa) y hay que mirarlo. */
  indicator: boolean | 'manual';
  obscured: boolean;
  /** Parada de la barra de Astro en `astro dev` (no existe en producción). */
  devOnly: boolean;
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function append(testInfo: TestInfo, record: StateRecord): Promise<void> {
  const file = testInfo.outputPath('a11y-audit.json');
  let states: StateRecord[] = [];
  try {
    states = (JSON.parse(await readFile(file, 'utf8')) as { states: StateRecord[] }).states;
  } catch {
    // primer estado de esta prueba
  }
  states.push(record);
  await writeFile(
    file,
    JSON.stringify({ project: testInfo.project.name, test: testInfo.title, states }, null, 2),
  );
}

/** Controles que deben medir al menos 24 px (WCAG 2.5.8) y, como objetivo propio, 44 px. */
async function measureTargets(page: Page) {
  return page.evaluate(() => {
    const sel =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="radio"], [role="checkbox"], [role="tab"], [tabindex]:not([tabindex="-1"])';
    const seen = new Set<Element>();
    const out: { name: string; selector: string; width: number; height: number }[] = [];
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.closest('[aria-hidden="true"], [inert]')) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden') continue;
      // Excepción de WCAG 2.5.8: enlaces en línea dentro del texto. Fuera de pantalla (enlace de salto sin foco): no cuenta.
      if (el.tagName === 'A' && cs.display === 'inline') continue;
      if (r.bottom + scrollY <= 0 || r.right + scrollX <= 0) continue;
      // Casillas y radios nativos: cuenta la etiqueta que los envuelve, si la hay.
      let box = r;
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        const label = el.closest('label') ?? el.labels?.[0];
        if (label) box = label.getBoundingClientRect();
      }
      const name = (
        el.getAttribute('aria-label') ??
        (el as HTMLInputElement).labels?.[0]?.textContent ??
        el.textContent ??
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/)[0] : '';
      out.push({
        name,
        selector: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`,
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
      });
    }
    return out;
  });
}

async function overflowPx(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

export interface AuditOptions {
  /** Restringe axe a una parte (p. ej. un diálogo). Por defecto, la página entera. */
  include?: string;
  focusStops?: FocusStop[];
  extra?: Record<string, unknown>;
}

export async function auditState(
  page: Page,
  testInfo: TestInfo,
  label: string,
  options: AuditOptions = {},
): Promise<StateRecord> {
  await settleAnimations(page);
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (options.include) builder = builder.include(options.include);
  const results = await builder.analyze();
  const axe: AxeFinding[] = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? 'unknown',
    help: v.help,
    targets: v.nodes.slice(0, 8).map((n) => n.target.join(' ')),
  }));
  const targets = await measureTargets(page);
  const vp = page.viewportSize();
  const record: StateRecord = {
    label,
    url: new URL(page.url()).pathname + new URL(page.url()).search,
    viewport: vp ? `${vp.width}x${vp.height}` : '?',
    lang: await page.evaluate(() => document.documentElement.lang),
    axe,
    targetsUnder24: targets.filter((t) => t.width < 24 || t.height < 24),
    targetsUnder44: targets.filter((t) => t.width < 44 || t.height < 44),
    overflowPx: await overflowPx(page),
    focusStops: options.focusStops,
    extra: options.extra,
  };
  await append(testInfo, record);

  const critical = axe.filter((a) => a.impact === 'critical');
  const serious = axe.filter((a) => a.impact === 'serious');
  expect(
    critical,
    `${label}: infracciones CRÍTICAS de axe\n${JSON.stringify(critical, null, 2)}`,
  ).toEqual([]);
  expect.soft(serious, `${label}: infracciones serias de axe`).toEqual([]);
  expect.soft(record.targetsUnder24, `${label}: objetivos < 24 px`).toEqual([]);
  expect.soft(record.overflowPx, `${label}: desbordamiento horizontal`).toBeLessThanOrEqual(0);
  return record;
}

/** Nombre accesible aproximado del elemento con foco (aria-label, aria-labelledby, etiqueta o texto). */
async function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    let name = clean(el.getAttribute('aria-label'));
    const by = el.getAttribute('aria-labelledby');
    if (!name && by)
      name = clean(
        by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' '),
      );
    const labels = (el as HTMLInputElement).labels;
    if (!name && labels && labels.length) name = clean(labels[0]!.textContent);
    if (!name) name = clean(el.textContent);
    const tag = el.tagName.toLowerCase();
    // La barra de herramientas de Astro (solo en `astro dev`) entra en el orden de Tab: no es de la app.
    if (tag === 'astro-dev-toolbar')
      return {
        name: '(barra de Astro, solo dev)',
        tag,
        indicator: true,
        obscured: false,
        devOnly: true,
      };
    // Indicador visible (2.4.7): contorno de ≥ 2 px o sombra en el propio elemento.
    const ring = (e: Element | null) => {
      if (!e) return false;
      const c = getComputedStyle(e);
      return (
        (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 2) || c.boxShadow !== 'none'
      );
    };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // Casilla o radio ocultos a la vista: el aro lo suele pintar su etiqueta o el elemento de al lado.
    const hiddenInput =
      el instanceof HTMLInputElement &&
      (cs.opacity === '0' || r.width <= 2 || r.height <= 2 || cs.clipPath !== 'none');
    const label = el.closest('label') ?? (el as HTMLInputElement).labels?.[0] ?? null;
    let indicator: boolean | 'manual' = ring(el);
    if (!indicator && hiddenInput)
      indicator =
        ring(el.nextElementSibling) ||
        ring(label) ||
        [...(label?.querySelectorAll('*') ?? [])].some(ring);
    // En SVG el aro de foco suele ser otra figura (D-155) y en `input[type=date]` lo pinta el navegador: a mano.
    if (!indicator && (el instanceof SVGElement || (el as HTMLInputElement).type === 'date'))
      indicator = 'manual';
    // Foco no tapado (2.4.11): el centro del elemento (o de su etiqueta, si está oculto) debe ser suyo.
    const box = hiddenInput && label ? label.getBoundingClientRect() : r;
    const cx = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
    const cy = Math.min(Math.max(box.top + box.height / 2, 0), window.innerHeight - 1);
    const hit = document.elementFromPoint(cx, cy);
    const outside = box.bottom < 0 || box.top > window.innerHeight;
    const own = (h: Element) =>
      el === h ||
      el.contains(h) ||
      h.contains(el) ||
      (!!label && (label === h || label.contains(h)));
    const obscured = outside || !hit || !own(hit);
    return { name: name.slice(0, 80), tag, indicator, obscured, devOnly: false };
  });
}

export interface TabTarget {
  name?: RegExp;
  /** CSS que debe cumplir el elemento con foco (`el.matches`). */
  selector?: string;
}

/**
 * Pulsa Tab hasta que el foco llega al objetivo (o falla tras `max` pulsaciones con la lista de paradas).
 * Devuelve las paradas visitadas, con su indicador de foco y si quedó tapado.
 */
export async function tabTo(page: Page, target: TabTarget, max = 80): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  const matches = async () => {
    const f = await focused(page);
    if (!f) return false;
    const okName = !target.name || target.name.test(f.name);
    const okSel =
      !target.selector ||
      (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, target.selector));
    return okName && okSel;
  };
  if (await matches()) return stops;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (f && !f.devOnly) stops.push(f);
    if (await matches()) return stops;
  }
  throw new Error(
    `Tab no llegó a ${target.name ?? ''} ${target.selector ?? ''} en ${max} pulsaciones. Paradas:\n` +
      stops.map((s) => `- ${s.tag} «${s.name}»`).join('\n'),
  );
}

/** Revisa las paradas: sin indicador de foco detectable o tapadas (blando: se revisan a mano). */
export function expectFocusStops(stops: FocusStop[], label: string): void {
  const noIndicator = stops.filter((s) => s.indicator === false);
  const obscured = stops.filter((s) => s.obscured);
  expect.soft(noIndicator, `${label}: paradas sin indicador de foco detectable`).toEqual([]);
  expect.soft(obscured, `${label}: paradas con el foco tapado o fuera de la pantalla`).toEqual([]);
}

/** Espaciado de texto de WCAG 1.4.12 (interlineado 1,5; párrafos 2; letras 0,12; palabras 0,16). */
export async function applyTextSpacing(page: Page): Promise<void> {
  // Por CSSOM (`style.setProperty`) y no con <style>: la CSP de la app bloquea estilos en línea, y así no se toca.
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (!(el instanceof HTMLElement)) continue;
      el.style.setProperty('line-height', '1.5', 'important');
      el.style.setProperty('letter-spacing', '0.12em', 'important');
      el.style.setProperty('word-spacing', '0.16em', 'important');
      if (el.tagName === 'P') el.style.setProperty('margin-bottom', '2em', 'important');
    }
  });
}

/**
 * Texto recortado tras `applyTextSpacing`: elementos con `overflow` oculto donde algún TEXTO visible queda fuera de
 * su caja. Lo que sobresale y está en `aria-hidden` (adornos de las esquinas) no cuenta: está ahí a propósito.
 */
export async function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.closest('[aria-hidden="true"], svg')) continue;
      const cs = getComputedStyle(el);
      if (!/(hidden|clip)/.test(cs.overflowX + cs.overflowY)) continue;
      const box = el.getBoundingClientRect();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent?.trim();
        const parent = n.parentElement;
        if (!text || !parent || parent.closest('[aria-hidden="true"]')) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (
          r.right > box.right + 1 ||
          r.bottom > box.bottom + 1 ||
          r.left < box.left - 1 ||
          r.top < box.top - 1
        ) {
          out.push(
            `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]} «${text.slice(0, 40)}»`,
          );
          break;
        }
      }
    }
    return out.slice(0, 20);
  });
}

/** Animaciones en marcha (para `prefers-reduced-motion`: debería no quedar ninguna). */
export async function runningAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        const name =
          (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'anim';
        return `${name} en ${target?.tagName.toLowerCase() ?? '?'}.${(target?.getAttribute('class') ?? '').split(' ')[0]}`;
      }),
  );
}
