// Genera src/lib/crypto/common-passwords.ts (D-122) a partir de una lista de contraseñas comunes, una por línea,
// ordenada de más a menos frecuente (como las listas «top N» habituales).
//
//   node scripts/build-common-passwords.mjs lista.txt `
//        --source "<URL de donde la descargaste>" --license "<licencia que figura en la fuente>" [--base 5000] [--out ruta]
//
// No descarga nada. Normaliza igual que `normalizeForList` (NFKC, minúsculas, sin espacios ni - _ .) y separa:
//   · COMMON_LONG: las de 14 o más caracteres (la longitud mínima de la app; las cortas ya se rechazan por longitud).
//   · COMMON_BASE: las primeras N (por defecto 5000) que son solo letras, de 4 a 13 caracteres: la «base» que la gente
//     rellena con números o símbolos hasta llegar a 14 («barcelona12345»).
// Comprueba que hay datos suficientes y escribe el SHA-256 del archivo de origen para poder verificarlo después.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export const MIN_LENGTH = 14;

export function normalizeForList(password) {
  return password
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_.]+/gu, '');
}

export function buildLists(text, { base = 5000, maxLong = 20000 } = {}) {
  const long = [];
  const baseWords = [];
  const seenLong = new Set();
  const seenBase = new Set();
  let lines = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    lines++;
    const key = normalizeForList(line);
    // eslint-disable-next-line no-control-regex -- se descartan justamente las líneas con caracteres de control
    if (key === '' || /[\u0000-\u001f\u007f'\\]/.test(key)) continue; // ni controles ni comillas: el archivo generado es TS
    const length = Array.from(key).length;
    if (length >= MIN_LENGTH) {
      if (long.length < maxLong && !seenLong.has(key)) {
        seenLong.add(key);
        long.push(key);
      }
    } else if (
      length >= 4 &&
      /^\p{L}+$/u.test(key) &&
      baseWords.length < base &&
      !seenBase.has(key)
    ) {
      seenBase.add(key);
      baseWords.push(key);
    }
  }
  return { long: long.sort(), base: baseWords, lines };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/build-common-passwords.mjs')) {
  const input = process.argv[2];
  const source = arg('--source');
  const license = arg('--license');
  const base = arg('--base') ? Number(arg('--base')) : 5000;
  const out = arg('--out') ?? 'src/lib/crypto/common-passwords.ts';
  if (!input || !source || !license) {
    console.error(
      'Uso: node scripts/build-common-passwords.mjs <lista.txt> --source <url> --license "<texto>" [--base 5000] [--out ruta]',
    );
    process.exit(2);
  }
  const buf = readFileSync(input);
  const { long, base: baseWords, lines } = buildLists(buf.toString('utf8'), { base });
  console.log(
    JSON.stringify({ lines, long: long.length, base: baseWords.length, baseWanted: base }),
  );
  if (lines < 1000 || baseWords.length < Math.min(base, 1000)) {
    console.error(
      'La lista parece demasiado corta o no es una lista de contraseñas: no se escribe nada.',
    );
    process.exit(1);
  }
  const sha = createHash('sha256').update(buf).digest('hex');
  const quote = (w) => `  '${w}',`;
  const clean = (s) => s.replace(/\*\//g, '* /').replace(/'/g, '’');
  const body =
    `/**\n * Lista de contraseñas comunes (D-122). GENERADA por scripts/build-common-passwords.mjs: no editar a mano.\n` +
    ` * Origen: ${clean(source)}\n * Licencia: ${clean(license)}\n * SHA-256 del archivo de origen: ${sha}\n` +
    ` * ${long.length} contraseñas de ${MIN_LENGTH}+ caracteres y ${baseWords.length} «bases» de 4–13 letras, normalizadas.\n */\n` +
    `export const COMMON_PASSWORDS_SOURCE = '${clean(source)}';\n` +
    `export const COMMON_PASSWORDS_LICENSE = '${clean(license)}';\n` +
    `export const COMMON_PASSWORDS_SHA256 = '${sha}';\n` +
    `export const COMMON_LONG: readonly string[] = [\n${long.map(quote).join('\n')}\n];\n` +
    `export const COMMON_BASE: readonly string[] = [\n${baseWords.map(quote).join('\n')}\n];\n`;
  writeFileSync(out, body, 'utf8');
  console.log(`Escrito ${out} (${Math.round(Buffer.byteLength(body) / 1024)} KiB).`);
}
