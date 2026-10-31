// H9.1 · Junta los registros de `test-results/**/a11y-audit.json` (de `npm run test:audit`) en una tabla para pegar.
// Uso: npm run audit:summary            → resumen
//      npm run audit:summary -- --full  → además, cada infracción y cada objetivo < 44 px
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = 'test-results';
const full = process.argv.includes('--full');

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name === 'a11y-audit.json') yield p;
  }
}

const rows = [];
for await (const file of walk(ROOT)) {
  const { project, test, states } = JSON.parse(await readFile(file, 'utf8'));
  for (const s of states) rows.push({ project, test, ...s });
}
if (rows.length === 0) {
  console.log('No hay registros. Ejecuta antes: npm run build; npm run test:audit');
  process.exit(1);
}
rows.sort((a, b) => a.label.localeCompare(b.label, 'es'));

const count = (list, impact) => list.filter((v) => v.impact === impact).length;
console.log(`# Auditoría H9.1 · ${rows.length} estados\n`);
console.log(
  '| Estado | Vista | lang | crít. | serias | mod. | menores | < 24 px | < 44 px | desbord. | sin foco visible | foco tapado |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const stops = r.focusStops ?? [];
  console.log(
    `| ${r.label} | ${r.viewport} | ${r.lang} | ${count(r.axe, 'critical')} | ${count(r.axe, 'serious')} | ${count(r.axe, 'moderate')} | ${count(r.axe, 'minor')} | ${r.targetsUnder24.length} | ${r.targetsUnder44.length} | ${r.overflowPx > 0 ? r.overflowPx + ' px' : '—'} | ${stops.length ? stops.filter((s) => s.indicator === false).length + (stops.some((s) => s.indicator === 'manual') ? ` (+${stops.filter((s) => s.indicator === 'manual').length} a mano)` : '') : '—'} | ${stops.length ? stops.filter((s) => s.obscured).length : '—'} |`,
  );
}

// Infracciones agrupadas por regla (una línea por regla, con los estados donde sale).
const byRule = new Map();
for (const r of rows)
  for (const v of r.axe) {
    const k = `${v.impact} · ${v.id}`;
    if (!byRule.has(k)) byRule.set(k, { help: v.help, states: new Set(), targets: new Set() });
    const e = byRule.get(k);
    e.states.add(r.label);
    v.targets.slice(0, 3).forEach((t) => e.targets.add(t));
  }
console.log('\n## Infracciones de axe por regla\n');
if (byRule.size === 0) console.log('Ninguna.');
for (const [k, e] of [...byRule].sort()) {
  console.log(`- **${k}** — ${e.help}`);
  console.log(`  - estados: ${[...e.states].join('; ')}`);
  console.log(
    `  - ejemplos: ${[...e.targets]
      .slice(0, 4)
      .map((t) => '`' + t + '`')
      .join(', ')}`,
  );
}

// Objetivos pequeños, sin repetir.
const small = new Map();
for (const r of rows)
  for (const t of r.targetsUnder44) {
    const k = `${t.selector} «${t.name}»`;
    const prev = small.get(k);
    const min = Math.min(t.width, t.height);
    if (!prev || min < prev.min)
      small.set(k, { min, size: `${t.width}×${t.height}`, state: r.label });
  }
console.log(`\n## Objetivos táctiles por debajo de 44 px (${small.size} distintos)\n`);
const list = [...small].sort((a, b) => a[1].min - b[1].min);
for (const [k, v] of full ? list : list.slice(0, 25))
  console.log(`- ${v.min < 24 ? '**< 24** ' : ''}${k}: ${v.size} (${v.state})`);
if (!full && list.length > 25) console.log(`- … y ${list.length - 25} más (usa --full)`);

const extras = rows.filter(
  (r) => r.extra && Object.values(r.extra).some((x) => Array.isArray(x) && x.length),
);
if (extras.length) {
  console.log('\n## Otros hallazgos\n');
  for (const r of extras) console.log(`- ${r.label}: ${JSON.stringify(r.extra)}`);
}
