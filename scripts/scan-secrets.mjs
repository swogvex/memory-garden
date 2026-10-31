// @ts-check
// PS-35 (heurístico): busca secretos en el árbol y en TODO el historial local, y revisa .gitignore.
// No sustituye a un escáner dedicado. No imprime nunca el valor completo encontrado.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SELF = 'scripts/scan-secrets.mjs';
const MAX_BYTES = 2_000_000;

/** @type {Array<[string, RegExp]>} */
const STRONG = [
  ['clave privada PEM', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['token de GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/],
  ['clave de AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['clave sk_ (Stripe y similares)', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/],
  ['token de Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['Authorization Bearer', /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/],
];
const GENERIC_NAME = 'asignación sospechosa (secreto/token/contraseña = "…")';
const GENERIC =
  /(?:secret|token|passw(?:or)?d|api[_-]?key|pepper|setup[_-]?code)["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i;
// La contraseña de la semilla de desarrollo es inventada y no llega a producción (PS-06).
const genericExempt = (/** @type {string} */ file) =>
  file.startsWith('tests/') || file === 'package-lock.json' || file === 'src/dev/seed.ts';

// Archivos que no deben estar versionados (las migraciones .sql sí).
const FORBIDDEN =
  /(?:^|\/)(?:\.env(?:\.(?!example$)[^/]*)?|\.dev\.vars(?:\.(?!example$)[^/]*)?|[^/]*\.(?:mgx|pem|key|p12|pfx|sql))$/;
// Migraciones de D1 y la copia de referencia sin datos reales (D-277).
const ALLOWED = /^(?:migrations\/|tests\/fixtures\/compat-v1\.mgx$)/;

const git = (/** @type {string[]} */ args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

const findings = new Map();
const mask = (/** @type {string} */ m) => `${m.slice(0, 6)}…(${m.length} car.)`;
function add(
  /** @type {string} */ what,
  /** @type {string} */ file,
  /** @type {string} */ where,
  value = '',
) {
  const key = `${what}|${file}|${value || where}`;
  if (!findings.has(key))
    findings.set(key, `${what} · ${file} · ${where}${value ? ` · ${mask(value)}` : ''}`);
}

function scanLine(
  /** @type {string} */ line,
  /** @type {string} */ file,
  /** @type {string} */ where,
) {
  if (line.length > 2000) return;
  for (const [name, re] of STRONG) {
    const m = re.exec(line);
    if (m) add(name, file, where, m[0]);
  }
  if (!genericExempt(file)) {
    const m = GENERIC.exec(line);
    if (m) add(GENERIC_NAME, file, where, m[0]);
  }
}

// 1) Árbol de trabajo (archivos versionados)
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
for (const f of tracked) {
  if (FORBIDDEN.test(f) && !ALLOWED.test(f)) add('archivo no deseado en el árbol', f, 'versionado');
  if (f === SELF) continue;
  let buf;
  try {
    buf = readFileSync(f);
  } catch {
    continue;
  }
  if (buf.length > MAX_BYTES || buf.includes(0)) continue;
  buf
    .toString('utf8')
    .split('\n')
    .forEach((line, i) => scanLine(line, f, `línea ${i + 1}`));
}

// 2) Historial completo local (todas las referencias, incluidas refs/agents/…)
let commit = '?';
let file = '?';
const log = git(['log', '--all', '-p', '--no-color', '--no-ext-diff', '--pretty=format:commit %h']);
for (const line of log.split('\n')) {
  if (line.startsWith('commit ')) {
    commit = line.slice(7).trim();
    continue;
  }
  if (line.startsWith('+++ ')) {
    file = line.slice(4).replace(/^b\//, '');
    continue;
  }
  if (line.startsWith('+') && file !== SELF) scanLine(line.slice(1), file, `commit ${commit}`);
}
const everAdded = git(['log', '--all', '--name-only', '--diff-filter=A', '--pretty=format:'])
  .split('\n')
  .filter(Boolean);
for (const f of new Set(everAdded)) {
  if (FORBIDDEN.test(f) && !ALLOWED.test(f))
    add('archivo no deseado añadido alguna vez', f, 'historial');
}

// 3) .gitignore
const ignore = readFileSync('.gitignore', 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim());
const has = (/** @type {string} */ p) => ignore.includes(p) || ignore.includes(`/${p}`);
for (const need of ['.env', '.dev.vars', '*.mgx']) {
  if (!has(need)) add('falta en .gitignore', '.gitignore', need);
}
if (!has('*.sql') && !has('backup-*.sql')) add('falta en .gitignore', '.gitignore', 'backup-*.sql');

// Resultado
console.log(`Archivos versionados revisados: ${tracked.length}`);
if (findings.size === 0) {
  console.log('Sin coincidencias. Es una búsqueda heurística: no demuestra ausencia de secretos.');
} else {
  console.log(`COINCIDENCIAS (${findings.size}). Revisa cada una; pueden ser falsos positivos:`);
  for (const f of findings.values()) console.log(`- ${f}`);
  process.exitCode = 1;
}
