// Peso en el bundle de los módulos de H3 y de Valibot (D-041). Minificado + gzip + brotli, como llegaría al navegador.
//   node scripts/measure-bundle.mjs
// Requiere `esbuild` (ya presente como dependencia transitiva de Vite/Astro) y `valibot` instalado.
// Mide cada entrada POR SEPARADO (el tamaño real de la app depende de lo que importe cada página: una página que no
// use la validación no la lleva, porque Astro/Vite hacen tree-shaking por ruta).
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error(
    'No se encuentra `esbuild`. Prueba: npm ls esbuild   (debería existir como dependencia de Vite/Astro).',
  );
  process.exit(1);
}

const root = process.cwd();
const VALIBOT_USED = [
  'array',
  'check',
  'literal',
  'maxLength',
  'minLength',
  'nullable',
  'picklist',
  'pipe',
  'regex',
  'safeParse',
  'strictObject',
  'string',
  'union',
];

const entries = [
  {
    name: 'valibot (solo las 13 funciones que usamos)',
    contents: `export { ${VALIBOT_USED.join(', ')} } from 'valibot';`,
  },
  {
    name: 'lib/validation (esquemas + comprobaciones, con Valibot)',
    contents: `export * from './src/lib/validation/index.ts';`,
  },
  {
    name: 'lib/validation/checks (sin Valibot)',
    contents: `export * from './src/lib/validation/checks.ts';`,
  },
  {
    name: 'lib/crypto (API pública, incluye la lista de palabras)',
    contents: `export * from './src/lib/crypto/index.ts';`,
  },
  {
    name: 'lib/crypto SIN la lista de palabras (lo que carga el acceso)',
    contents: `export { createVault, preparePassword, unwrapWithPassword, prepareRecovery, unwrapWithRecovery, changePassword, upgradeKdf, regenerateRecoveryKey, resetViaRecovery, Keyring } from './src/lib/crypto/index.ts';`,
  },
  {
    name: 'lib/crypto/wordlist-es (2.048 palabras; solo al generar una frase de paso)',
    contents: `export * from './src/lib/crypto/wordlist-es.ts';`,
  },
  {
    name: 'lib/storage (interfaz, sin adaptador)',
    contents: `export * from './src/lib/storage/index.ts';`,
  },
  {
    name: 'lib/storage/dev-memory-adapter (solo desarrollo)',
    contents: `export * from './src/lib/storage/dev-memory-adapter.ts';`,
  },
];

const kb = (n) => (n / 1024).toFixed(2);
const rows = [];
for (const e of entries) {
  try {
    const r = await esbuild.build({
      stdin: { contents: e.contents, resolveDir: root, sourcefile: 'entry.ts', loader: 'ts' },
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      write: false,
      logLevel: 'silent',
    });
    const code = r.outputFiles[0].contents;
    rows.push({
      name: e.name,
      raw: code.length,
      gz: gzipSync(code, { level: 9 }).length,
      br: brotliCompressSync(code).length,
    });
  } catch (err) {
    rows.push({ name: e.name, error: String(err.errors?.[0]?.text ?? err.message).split('\n')[0] });
  }
}

console.log(`esbuild ${esbuild.version} · Node ${process.version} · ${resolve(root)}`);
console.log('| Entrada | minificado (KiB) | gzip (KiB) | brotli (KiB) |');
console.log('|---|---:|---:|---:|');
for (const r of rows) {
  console.log(
    r.error
      ? `| ${r.name} | — | — | — (${r.error}) |`
      : `| ${r.name} | ${kb(r.raw)} | ${kb(r.gz)} | ${kb(r.br)} |`,
  );
}
