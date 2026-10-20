// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as publicCrypto from '../../src/lib/crypto';

/**
 * Reglas estáticas (PS-16, PS-28 y las reglas de H3 sobre claves y almacenamiento).
 * Son pruebas de «escaneo del código fuente» y complementan, no sustituyen, a una regla de ESLint.
 * Se ejecutan desde la raíz del proyecto (cwd de Vitest).
 */
const SRC = resolve(process.cwd(), 'src');
const EXT = /\.(ts|js|mjs|svelte|astro)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}
/** Quita comentarios para no dar falsos positivos con lo que solo se MENCIONA en la documentación. */
function code(p: string): string {
  return readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/) // también finales de línea de Windows (CRLF): sin esto el comentario de la última línea no se quita
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}
const rel = (p: string): string => relative(process.cwd(), p).split(sep).join('/');
const files = walk(SRC);
const inLib = (names: string[]) =>
  files.filter((f) => names.some((n) => rel(f).startsWith(`src/lib/${n}/`)));

function offenders(list: string[], re: RegExp): string[] {
  return list.filter((f) => re.test(code(f))).map(rel);
}

describe('el escaneo funciona (si no encuentra archivos, las demás pruebas no valdrían nada)', () => {
  it('encuentra los módulos de H3', () => {
    expect(inLib(['crypto']).length).toBeGreaterThanOrEqual(10);
    expect(inLib(['storage']).length).toBeGreaterThanOrEqual(4);
    expect(inLib(['validation']).length).toBeGreaterThanOrEqual(3);
  });
  it('el detector detecta (control positivo)', () => {
    const sample = 'const a = Math.random(); // Math.random en un comentario no cuenta';
    expect(/Math\.random/.test(sample.replace(/(^|\s)\/\/.*$/, '$1'))).toBe(true);
    expect(/Math\.random/.test('// Math.random\n'.replace(/(^|\s)\/\/.*$/gm, '$1'))).toBe(false);
  });
});

describe('PS-16: aleatoriedad y fuentes prohibidas en lib/crypto', () => {
  const crypto = inLib(['crypto']);
  it.each([
    ['Math.random', /Math\.random/],
    ['Date.now / new Date() como semilla', /Date\.now\s*\(|new Date\s*\(/],
    ['crypto.randomUUID (los ids son de 128 bits propios, sin versión ni hora)', /randomUUID/],
  ])('ningún archivo usa %s', (_n, re) => {
    expect(offenders(crypto, re as RegExp)).toEqual([]);
  });
  it('getRandomValues solo se llama desde bytes.ts (única fuente de aleatoriedad)', () => {
    const users = crypto.filter((f) => /getRandomValues/.test(code(f))).map(rel);
    expect(users).toEqual(['src/lib/crypto/bytes.ts']);
  });
});

describe('reglas de H3: claves, almacenamiento y registros', () => {
  const guarded = inLib(['crypto', 'storage', 'validation']);

  it('ningún módulo de H3 usa localStorage, sessionStorage, IndexedDB, Cache API, cookies ', () => {
    expect(
      offenders(
        guarded,
        /\b(localStorage|sessionStorage|indexedDB|caches|document\.cookie|BroadcastChannel)\b/,
      ),
    ).toEqual([]);
  });
  it('ningún módulo de H3 escribe en consola', () => {
    expect(offenders(guarded, /\bconsole\s*\./)).toEqual([]);
  });
  it('ningún módulo de H3 usa eval, new Function ni importa dinámicamente', () => {
    expect(offenders(guarded, /\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(/)).toEqual([]);
  });
  it('las claves nunca se exportan: sin exportKey/wrapKey/generateKey y todas las importaciones y derivaciones son no extraíbles', () => {
    const crypto = inLib(['crypto']);
    expect(offenders(crypto, /\.(exportKey|wrapKey|unwrapKey|generateKey)\s*\(/)).toEqual([]);
    expect(offenders(crypto, /extractable\s*:\s*true/)).toEqual([]);
    for (const f of crypto) {
      const src = code(f);
      for (const m of src.matchAll(/\.(importKey|deriveKey)\s*\(/g)) {
        const call = src.slice(m.index, m.index + 400);
        const ok =
          m[1] === 'importKey' ? /,\s*false\s*,\s*\[/.test(call) : /,\s*false\s*,\s*\[/.test(call);
        expect(`${rel(f)}:${m[1]}:${ok}`).toBe(`${rel(f)}:${m[1]}:true`);
      }
    }
  });
  it('la API pública de lib/crypto no expone utilidades de prueba ni los bytes de la clave', () => {
    const names = Object.keys(publicCrypto);
    for (const forbidden of [
      'sealWithNonce',
      'seal',
      'open',
      'crc10',
      'derivePasswordSecrets',
      'hkdfSecrets',
      'randomBytes',
    ]) {
      expect(names).not.toContain(forbidden);
    }
    expect(names).toContain('createVault');
    expect(names).toContain('Keyring');
  });
});

describe('separación de código de prueba y de producción', () => {
  it('el adaptador en memoria solo lo importan las pruebas y las rutas /dev/ (D-049)', () => {
    const users = files
      .filter((f) => !rel(f).startsWith('src/lib/storage/dev-memory-adapter'))
      .filter((f) => /dev-memory-adapter/.test(code(f)))
      .map(rel);
    for (const u of users) {
      // D-049: solo código de desarrollo. `src/dev/` se carga únicamente tras `import.meta.env.DEV`.
      expect(/^src\/dev\//.test(u) || /^src\/(pages|features\/[^/]+)\/dev\//.test(u), u).toBe(true);
    }
    expect(users.length).toBeGreaterThanOrEqual(0);
  });
  it('fuera de lib/crypto nadie toca la política de KDF (solo pruebas pasan `policy`)', () => {
    const outside = files.filter((f) => !rel(f).startsWith('src/lib/crypto/'));
    expect(offenders(outside, /\bminIter\b|\bmaxIter\b|\btargetIter\b/)).toEqual([]);
  });
  it('el adaptador falla en producción (import.meta.env.PROD)', () => {
    expect(code(resolve(SRC, 'lib/storage/dev-memory-adapter.ts'))).toMatch(/PROD\s*===\s*true/);
  });
});

describe('PS-28: sumideros de HTML prohibidos en todo src/', () => {
  it.each([
    ['{@html}', /\{@html\b/],
    ['set:html (Astro)', /\bset:html\b/],
    ['innerHTML / outerHTML', /\b(innerHTML|outerHTML)\b/],
    ['insertAdjacentHTML', /insertAdjacentHTML/],
    ['document.write', /document\.write/],
  ])('ningún archivo usa %s', (_n, re) => {
    expect(offenders(files, re as RegExp)).toEqual([]);
  });
});
