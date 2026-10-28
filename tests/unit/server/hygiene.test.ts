import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { D1Like } from '@/server/d1';
import { doSetup, makeHarness, newSecrets, setupBody } from './_support';

/** PS-22 (respuestas genéricas), PS-42 (errores sin datos), PS-01 (sin SQL concatenado), PS-06 (sin rutas de reinicio). */
const SRC = join(process.cwd(), 'src', 'server');
const files = () =>
  readdirSync(SRC)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ f, text: readFileSync(join(SRC, f), 'utf8') }));

const logged: unknown[][] = [];
const original = {
  error: console.error,
  log: console.log,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
};
function capture(): void {
  for (const k of Object.keys(original) as (keyof typeof original)[])
    console[k] = (...a: unknown[]) => void logged.push([k, ...a]);
}
afterEach(() => {
  Object.assign(console, original);
  logged.length = 0;
});

describe('PS-22 · respuestas indistinguibles', () => {
  it('login: contraseña errónea y cuenta inexistente dan el mismo estado, cuerpo y cabeceras', async () => {
    const withAccount = makeHarness();
    await doSetup(withAccount);
    const empty = makeHarness();
    const a = await withAccount.call('POST', '/api/auth/login', {
      body: { auth_pw: newSecrets().authPw },
    });
    const b = await empty.call('POST', '/api/auth/login', {
      body: { auth_pw: newSecrets().authPw },
    });
    expect(a.status).toBe(401);
    expect(b.status).toBe(a.status);
    expect(b.text).toBe(a.text);
    expect([...b.headers].sort()).toEqual([...a.headers].sort());
  });

  it('recuperación: igual con y sin cuenta; y el cuerpo mal formado también es genérico', async () => {
    const withAccount = makeHarness();
    await doSetup(withAccount);
    const empty = makeHarness();
    const body = { auth_rec: newSecrets().authRec };
    const a = await withAccount.call('POST', '/api/auth/recover', { body });
    const b = await empty.call('POST', '/api/auth/recover', { body });
    expect([b.status, b.text]).toEqual([a.status, a.text]);
  });

  it('primer acceso: código erróneo, código ausente y servidor sin código configurado dan la misma respuesta', async () => {
    const wrong = await makeHarness().call('POST', '/api/setup', {
      body: setupBody(newSecrets(), { setup_code: 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX' }),
    });
    const withoutCode: Record<string, unknown> = { ...setupBody(newSecrets()) };
    delete withoutCode.setup_code;
    const missing = await makeHarness().call('POST', '/api/setup', {
      body: withoutCode,
    });
    const none = await makeHarness({ SETUP_CODE: undefined }).call('POST', '/api/setup', {
      body: setupBody(newSecrets()),
    });
    expect(wrong.status).toBe(401);
    for (const r of [missing, none]) expect([r.status, r.text]).toEqual([wrong.status, wrong.text]);
  });

  it('el mensaje de error nunca revela qué parte falló ni menciona cuenta, contraseña o código', async () => {
    const h = makeHarness();
    await doSetup(h);
    const r = await h.call('POST', '/api/auth/login', { body: { auth_pw: newSecrets().authPw } });
    expect(r.text).not.toMatch(/account|cuenta|password|contrase|code|c[oó]digo|exist/i);
  });
});

describe('PS-42 · errores internos y registros', () => {
  let savedCookie = ''; // sesión creada ANTES de romper D1: el cierre de sesión solo toca la base de datos si hay cookie

  const failing = (h: ReturnType<typeof makeHarness>, when: (sql: string) => boolean): void => {
    const real = h.env.DB as D1Like;
    h.env.DB = {
      prepare(sql: string) {
        if (when(sql))
          throw new Error('SECRETO-DE-PRUEBA: fallo interno con datos sensibles ' + sql);
        return real.prepare(sql);
      },
      batch: (s) => real.batch(s),
    } as D1Like;
  };

  it('un fallo de D1 → 500 genérico; en el registro solo «mg:error» y el nombre del error', async () => {
    const h = makeHarness();
    savedCookie = (await doSetup(h)).cookie;
    capture();
    failing(h, (sql) => sql.startsWith('SELECT'));
    const secrets = newSecrets();
    const cookie = savedCookie;
    for (const [method, path] of [
      ['GET', '/api/auth/params'],
      ['POST', '/api/auth/login'],
      ['POST', '/api/auth/recover'],
      ['POST', '/api/auth/logout'],
    ] as const) {
      const r = await h.call(method, path, {
        cookie,
        body: { auth_pw: secrets.authPw, auth_rec: secrets.authRec },
      });
      expect(r.status).toBe(500);
      expect(r.json).toEqual({ error: 'server_error' });
      expect(r.text).not.toContain('SECRETO');
    }
    expect(logged.length).toBeGreaterThan(0);
    for (const entry of logged) {
      expect(entry[0]).toBe('error');
      expect(entry[1]).toBe('mg:error');
      expect(entry).toHaveLength(3);
      expect(entry[2]).toBe('Error');
      expect(JSON.stringify(entry)).not.toContain('SECRETO');
      expect(JSON.stringify(entry)).not.toContain(secrets.authPw);
    }
  });

  it('flujo normal (alta, acceso correcto e incorrecto, límite): no escribe nada en la consola', async () => {
    capture();
    const h = makeHarness();
    const { secrets } = await doSetup(h);
    await h.call('POST', '/api/auth/login', { body: { auth_pw: secrets.authPw } });
    for (let i = 0; i < 5; i++)
      await h.call('POST', '/api/auth/login', { body: { auth_pw: newSecrets().authPw } });
    expect(logged).toEqual([]);
  });

  it('el código fuente del servidor no registra en consola salvo la línea única de errores', () => {
    const hits = files().flatMap(({ f, text }) =>
      text
        .split('\n')
        .filter((l) => /console\./.test(l))
        .map((l) => `${f}: ${l.trim()}`),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("console.error('mg:error'");
  });
});

describe('PS-01 · inyección SQL', () => {
  const payloads = [
    "' OR '1'='1",
    "'; DROP TABLE account; --",
    '" OR 1=1 --',
    '\\',
    '\u0000',
    "Robert'); DELETE FROM session;--",
  ];

  it('cargas de inyección en cualquier campo no alteran la base de datos ni dan errores 500', async () => {
    const h = makeHarness();
    const { secrets, cookie } = await doSetup(h);
    const before = JSON.stringify(
      ['account', 'vault', 'session'].map((t) => h.raw.prepare(`SELECT * FROM ${t}`).all()),
    );
    for (const p of payloads) {
      const replies = [
        await h.call('POST', '/api/auth/login', { body: { auth_pw: p } }),
        await h.call('POST', '/api/auth/recover', { body: { auth_rec: p } }),
        await h.call('POST', '/api/setup', {
          body: setupBody(secrets, { setup_code: p, vault_id: p, kdf: p, rec_salt: p }),
        }),
        await h.call('PUT', '/api/vault/password', {
          cookie,
          body: {
            current_auth_pw: p,
            auth_pw: p,
            kdf: p,
            wrapped_mk_pw: p,
            expected_key_revision: p,
          },
        }),
        await h.call('POST', '/api/auth/login', {
          rawBody: JSON.stringify({ auth_pw: p, extra: { [p]: p } }),
        }),
        await h.call('GET', `/api/auth/params?x=${encodeURIComponent(p)}`),
      ];
      for (const r of replies) expect(r.status).toBeLessThan(500);
      h.raw.prepare('DELETE FROM login_attempt').run(); // el límite de intentos no es lo que se prueba aquí
    }
    const after = JSON.stringify(
      ['account', 'vault', 'session'].map((t) => h.raw.prepare(`SELECT * FROM ${t}`).all()),
    );
    expect(after).toBe(before);
    expect(
      h.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'account'").all(),
    ).toHaveLength(1);
  });

  /** Argumento de cada `.prepare(...)`, respetando comillas y paréntesis anidados. */
  function prepareArgs(text: string): string[] {
    const out: string[] = [];
    for (const m of text.matchAll(/\.prepare\(/g)) {
      let depth = 1;
      let quote = '';
      let i = (m.index ?? 0) + m[0].length;
      const start = i;
      for (; i < text.length && depth > 0; i++) {
        const c = text[i] as string;
        if (quote) {
          if (c === '\\') i++;
          else if (c === quote) quote = '';
        } else if (c === "'" || c === '"' || c === '`') quote = c;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
      }
      out.push(
        text
          .slice(start, i - 1)
          .trim()
          .replace(/,$/, ''),
      );
    }
    return out;
  }

  it('análisis estático: todo `.prepare(` recibe un literal entre comillas o una constante MAYÚSCULAS, sin `${}` ni concatenación', () => {
    let seen = 0;
    for (const { f, text } of files()) {
      for (const arg of prepareArgs(text)) {
        seen++;
        const single = /^(['"])(?:\\.|(?!\1)[^\\])*\1$/.test(arg);
        const joined = /^(?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+$/.test(arg); // literales partidos en líneas, solo con `+` entre literales
        const constant = /^[A-Z][A-Z0-9_]*$/.test(arg);
        expect(single || joined || constant, `${f}: .prepare(${arg.slice(0, 70)})`).toBe(true);
        expect(arg.includes('${'), `${f}: ${arg.slice(0, 70)}`).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(15); // el análisis ve las consultas de verdad
  });

  it('análisis estático: ninguna plantilla de cadena con SQL lleva `${}`', () => {
    for (const { f, text } of files()) {
      for (const m of text.matchAll(/`([^`]*)`/g)) {
        const body = m[1] ?? '';
        if (/\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(body))
          expect(body, `${f}: ${body.slice(0, 60)}`).not.toContain('${');
      }
    }
  });
});

describe('PS-06 · sin rutas de reinicio ni depuración', () => {
  it('ni los archivos de src/server ni src/pages/api definen rutas con reset/debug/dev/admin', () => {
    const pages = join(process.cwd(), 'src', 'pages', 'api');
    const names = readdirSync(pages, { recursive: true }).map(String);
    for (const n of names)
      expect(n).not.toMatch(/(^|[\\/])(reset|debug|dev|admin|wipe|seed|test)([\\/.]|$)/i);
    for (const { f, text } of files()) {
      expect(text, f).not.toMatch(
        /\/api\/(?:[\w-]+\/)*(reset|debug|dev|admin|wipe|seed)(?=['"`/])/i,
      );
    }
  });
});
