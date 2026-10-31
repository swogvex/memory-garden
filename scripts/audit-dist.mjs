// H9.1 · Pesos de `dist/client` frente a los presupuestos (después de `npm run build`).
// Mide sin comprimir, gzip (nivel 9) y brotli (calidad 11) con node:zlib. Cloudflare comprime al servir:
// la cifra transferida real está entre las dos (compárala con la pestaña Red o Lighthouse).
// «Carga inicial» = lo que pide el HTML de la portada (scripts, islas, hojas) y sus imports ESTÁTICOS;
// los `import()` dinámicos (lista de comunes, frase de paso…) se listan aparte como diferidos.
// Uso: npm run audit:dist            → tabla y estado de cada presupuesto (sale con código 1 si alguno no se cumple)
//      npm run audit:dist -- --all   → además, todos los archivos
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const ROOT = 'dist/client';
const KiB = 1024;
const showAll = process.argv.includes('--all');

/** Presupuestos de H9 (provisionales hasta medir; se fijan en `performance-report.md`). */
const BUDGETS = {
  initialJsGzip: 150 * KiB,
  cssGzip: 35 * KiB,
  firstLoadFonts: 120 * KiB,
  accessDecorGzip: 60 * KiB,
  texture: 30 * KiB,
  html: 10 * KiB,
};

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

if (!existsSync(ROOT)) {
  console.error(`No existe ${ROOT}: ejecuta npm run build en el repositorio de Memory Garden.`);
  process.exit(2);
}

const files = new Map(); // ruta pública ("/_astro/x.js") → datos
for await (const abs of walk(ROOT)) {
  const rel = '/' + relative(ROOT, abs).split(sep).join('/');
  const buf = await readFile(abs);
  const compressible = !/\.(woff2?|webp|png|jpe?g|ico)$/i.test(rel);
  files.set(rel, {
    rel,
    buf,
    raw: (await stat(abs)).size,
    gzip: compressible ? gzipSync(buf, { level: 9 }).length : buf.length,
    br: compressible
      ? brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
      : buf.length,
  });
}
if (!files.has('/index.html') || !files.has('/jardin/index.html')) {
  console.error(
    'No encuentro dist/client/index.html ni dist/client/jardin/index.html: ejecuta npm run build en el repositorio de Memory Garden.',
  );
  process.exit(2);
}

const resolve = (from, spec) =>
  spec.startsWith('/') ? spec : posix.join(posix.dirname(from), spec);

// 1) Lo que pide el HTML de la portada.
const html = files.get('/index.html').buf.toString('utf8');
const entry = new Set();
const css = new Set();
for (const m of html.matchAll(/(?:component-url|renderer-url|before-hydration-url)="([^"]+)"/g))
  entry.add(m[1]);
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) entry.add(m[1]);
for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) entry.add(m[1]);
for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) css.add(m[1]);

// 2) Imports estáticos (recursivos) frente a dinámicos.
const initial = new Set();
const lazy = new Set();
const queue = [...entry].filter((p) => files.has(p));
while (queue.length) {
  const p = queue.shift();
  if (initial.has(p)) continue;
  initial.add(p);
  const src = files.get(p).buf.toString('utf8');
  for (const m of src.matchAll(/(?:\bimport|\bfrom)\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) {
    const dep = resolve(p, m[1]);
    if (files.has(dep) && !initial.has(dep)) queue.push(dep);
  }
  // Diferidos: cualquier otro chunk que este archivo nombre sin importarlo estáticamente (Vite usa `import()` y
  // `__vitePreload`/`__vite__mapDeps`, con formas que cambian entre versiones; basta con que aparezca el nombre).
  for (const f of files.values())
    if (f.rel.endsWith('.js') && f.rel !== p && src.includes(posix.basename(f.rel)))
      lazy.add(f.rel);
}
for (const p of initial) lazy.delete(p);

// 3) Fuentes que pide la portada: el navegador solo baja los subconjuntos cuyo `unicode-range` usa el texto.
// Con texto en español e inglés son los `-latin-` (no `latin-ext`) en woff2; se comprueba con la pestaña Red.
const fonts = [...files.values()].filter((f) => /\.(woff2?)$/.test(f.rel));
const firstFonts = fonts.filter((f) => /-latin-(?!ext)/.test(f.rel) && f.rel.endsWith('.woff2'));
const decorAccess = [...files.values()].filter((f) =>
  /^\/decor\/(c[1-4]-(base|sway)|mark)\.svg$/.test(f.rel),
);
const decorAll = [...files.values()].filter((f) => f.rel.startsWith('/decor/'));
const textures = [...files.values()].filter((f) => f.rel.startsWith('/textures/'));
const htmls = [...files.values()].filter((f) => f.rel.endsWith('.html'));
const allJs = [...files.values()].filter((f) => f.rel.endsWith('.js'));
const allCss = [...files.values()].filter((f) => f.rel.endsWith('.css'));

const sum = (list, key) => list.reduce((n, f) => n + f[key], 0);
const k = (n) => (n / KiB).toFixed(1);
const pick = (set) => [...set].map((p) => files.get(p)).filter(Boolean);

const results = [];
const check = (name, value, budget, note = '') => {
  const ok = value <= budget;
  results.push({ name, value, budget, ok, note });
};
const initialJs = pick(initial);
check(
  'JS inicial (gzip)',
  sum(initialJs, 'gzip'),
  BUDGETS.initialJsGzip,
  `${initialJs.length} archivos; brotli ${k(sum(initialJs, 'br'))} KiB; sin comprimir ${k(sum(initialJs, 'raw'))} KiB`,
);
check(
  'CSS enlazado (gzip)',
  sum(pick(css), 'gzip'),
  BUDGETS.cssGzip,
  `${css.size} hojas; total CSS en dist ${k(sum(allCss, 'gzip'))} KiB gzip`,
);
check(
  'Fuentes de la primera carga (woff2 latin)',
  sum(firstFonts, 'raw'),
  BUDGETS.firstLoadFonts,
  firstFonts.map((f) => posix.basename(f.rel).split('.')[0]).join(', '),
);
check(
  'Adornos del acceso (gzip)',
  sum(decorAccess, 'gzip'),
  BUDGETS.accessDecorGzip,
  `${decorAccess.length} SVG; todos los adornos ${k(sum(decorAll, 'gzip'))} KiB gzip`,
);
for (const t of textures) check(`Textura ${posix.basename(t.rel)}`, t.raw, BUDGETS.texture);
for (const h of htmls) check(`HTML ${h.rel}`, h.raw, BUDGETS.html);

console.log('# Pesos de dist/client (H9.1)\n');
console.log('| Presupuesto | Medido (KiB) | Límite (KiB) | Estado | Nota |');
console.log('|---|---|---|---|---|');
for (const r of results)
  console.log(
    `| ${r.name} | ${k(r.value)} | ${k(r.budget)} | ${r.ok ? 'cumple' : '**NO cumple**'} | ${r.note} |`,
  );

const table = (title, list) => {
  console.log(`\n## ${title}\n`);
  console.log('| Archivo | Sin comprimir | gzip | brotli |');
  console.log('|---|---|---|---|');
  for (const f of [...list].sort((a, b) => b.raw - a.raw))
    console.log(`| ${f.rel} | ${k(f.raw)} | ${k(f.gzip)} | ${k(f.br)} |`);
};
table('JavaScript de la carga inicial', initialJs);
table('JavaScript diferido (import dinámico)', pick(lazy));
const other = allJs.filter((f) => !initial.has(f.rel) && !lazy.has(f.rel));
if (other.length) table('Otro JavaScript (no enlazado desde la portada)', other);
console.log(
  `\n## Fuentes\n\nEn dist: ${fonts.length} archivos, ${k(sum(fonts, 'raw'))} KiB (woff2: ${fonts.filter((f) => f.rel.endsWith('.woff2')).length}; woff de respaldo: ${fonts.filter((f) => f.rel.endsWith('.woff')).length}). ` +
    `Primera carga estimada: ${firstFonts.length} archivos, ${k(sum(firstFonts, 'raw'))} KiB. El resto solo se descarga si el texto usa esos caracteres.`,
);
if (showAll) table('Todos los archivos', [...files.values()]);

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? 'Todos los presupuestos se cumplen.' : `${failed.length} presupuesto(s) sin cumplir.`}`,
);
process.exit(failed.length ? 1 : 0);
