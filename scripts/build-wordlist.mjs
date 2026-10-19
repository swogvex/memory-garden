// Genera src/lib/crypto/wordlist-es.ts a partir de un archivo de texto con una palabra por línea.
//
//   curl.exe -L -o spanish.txt https://raw.githubusercontent.com/bitcoin/bips/master/bip-0039/spanish.txt
//   node scripts/build-wordlist.mjs spanish.txt --expect 2048 `
//        --source "https://github.com/bitcoin/bips/blob/master/bip-0039/spanish.txt" `
//        --license "MIT (declarada por BIP-0039; confirmar la nota de copyright)"
//
// No descarga nada ni inventa palabras: normaliza (minúsculas, sin acentos ni ñ/ü para que se pueda teclear en cualquier
// teclado) y COMPRUEBA: número exacto de palabras, solo a–z, sin duplicados tras quitar acentos, y avisa de longitudes.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export function normalizeWordlist(text, { expect } = {}) {
  const raw = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const words = raw.map((w) => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
  const problems = [];
  if (expect !== undefined && words.length !== expect)
    problems.push(`se esperaban ${expect} palabras y hay ${words.length}`);
  words.forEach((w, i) => {
    if (!/^[a-z]+$/.test(w))
      problems.push(`línea ${i + 1}: «${raw[i]}» no queda en a–z tras quitar acentos`);
  });
  const seen = new Map();
  words.forEach((w, i) => {
    if (seen.has(w))
      problems.push(`duplicada tras quitar acentos: «${raw[seen.get(w)]}» y «${raw[i]}»`);
    else seen.set(w, i);
  });
  const lens = words.map((w) => w.length);
  const prefixes = new Set(words.map((w) => w.slice(0, 4)));
  return {
    words,
    problems,
    stats: {
      count: words.length,
      minLen: Math.min(...lens),
      maxLen: Math.max(...lens),
      uniqueFirst4: prefixes.size,
      bitsPerWord: Math.log2(words.length),
    },
  };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (
  import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('build-wordlist.mjs')
) {
  const input = process.argv[2];
  const source = arg('--source');
  const license = arg('--license');
  const expect = arg('--expect') ? Number(arg('--expect')) : undefined;
  const out = arg('--out') ?? 'src/lib/crypto/wordlist-es.ts';
  if (!input || !source || !license) {
    console.error(
      'Uso: node scripts/build-wordlist.mjs <archivo.txt> --expect 2048 --source <url> --license "<texto>" [--out ruta]',
    );
    process.exit(2);
  }
  const buf = readFileSync(input);
  const { words, problems, stats } = normalizeWordlist(buf.toString('utf8'), { expect });
  console.log(JSON.stringify(stats));
  if (problems.length > 0) {
    console.error(problems.slice(0, 20).join('\n'));
    console.error(`${problems.length} problema(s): no se escribe nada.`);
    process.exit(1);
  }
  const sha = createHash('sha256').update(buf).digest('hex');
  const body =
    `/**\n * Lista de palabras en español para la frase de paso (crypto-spec §4.5, D-063). GENERADA por scripts/build-wordlist.mjs.\n` +
    ` * Origen: ${source}\n * Licencia: ${license}\n * SHA-256 del archivo de origen: ${sha}\n` +
    ` * ${stats.count} palabras → ${stats.bitsPerWord.toFixed(2)} bits por palabra. Minúsculas a–z sin acentos (se teclean en cualquier teclado).\n */\n` +
    `export const WORDLIST_ES: readonly string[] = [\n${words.map((w) => `  '${w}',`).join('\n')}\n];\n`;
  writeFileSync(out, body, 'utf8');
  console.log(`Escrito ${out} (${words.length} palabras).`);
}
