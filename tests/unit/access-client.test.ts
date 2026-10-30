import { describe, expect, it } from 'vitest';
import { AuthError, createAuthClient, type AuthErrorCode } from '@/features/access/auth-client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers });
const clientWith = (reply: () => Response | Promise<Response>) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFake = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return reply();
  }) as typeof fetch;
  return { client: createAuthClient({ fetch: fetchFake }), calls };
};
const codeOf = async (
  p: Promise<unknown>,
): Promise<{ code: AuthErrorCode; retryAfter: number | null }> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof AuthError) return { code: e.code, retryAfter: e.retryAfter };
    throw e;
  }
  throw new Error('se esperaba un error');
};

describe('cliente de autenticación', () => {
  it('traduce los estados HTTP a códigos sin depender de textos del servidor', async () => {
    const table: [number, unknown, AuthErrorCode][] = [
      [401, { error: 'invalid_credentials' }, 'invalid_credentials'],
      [401, { error: 'unauthorized' }, 'unauthorized'],
      [401, null, 'unauthorized'],
      [409, { error: 'conflict' }, 'conflict'],
      [400, { error: 'bad_request' }, 'rejected'],
      [403, { error: 'forbidden' }, 'rejected'],
      [500, { error: 'server_error' }, 'unavailable'],
      [503, null, 'unavailable'],
    ];
    for (const [status, body, expected] of table) {
      const { client } = clientWith(() => json(status, body));
      expect((await codeOf(client.login('x'))).code).toBe(expected);
    }
  });

  it('429: lee la espera del cuerpo o de Retry-After y la acota', async () => {
    expect(
      await codeOf(
        clientWith(() => json(429, { error: 'rate_limited', retry_after: 15 })).client.login('x'),
      ),
    ).toEqual({ code: 'rate_limited', retryAfter: 15 });
    expect(
      (await codeOf(clientWith(() => json(429, null, { 'Retry-After': '7' })).client.login('x')))
        .retryAfter,
    ).toBe(7);
    expect(
      (await codeOf(clientWith(() => json(429, { retry_after: 0 })).client.login('x'))).retryAfter,
    ).toBe(1);
    expect(
      (await codeOf(clientWith(() => json(429, { retry_after: 99999 })).client.login('x')))
        .retryAfter,
    ).toBe(3600);
  });

  it('sin red, o con una respuesta de otra forma, es «no disponible»', async () => {
    const down = createAuthClient({
      fetch: (() => Promise.reject(new TypeError('x'))) as typeof fetch,
    });
    expect((await codeOf(down.params())).code).toBe('unavailable');
    expect(
      (await codeOf(clientWith(() => json(200, { configured: 'sí' })).client.params())).code,
    ).toBe('unavailable');
    expect(
      (await codeOf(clientWith(() => json(200, { vault_id: 'a' })).client.login('x'))).code,
    ).toBe('unavailable');
    expect(
      (await codeOf(clientWith(() => new Response('<html>', { status: 200 })).client.params()))
        .code,
    ).toBe('unavailable');
  });

  it('params acepta ambas formas; login manda solo `auth_pw`, sin cookies ajenas ni redirecciones', async () => {
    expect(
      await clientWith(() =>
        json(200, { configured: false, kdf: null, rec_salt: null }),
      ).client.params(),
    ).toEqual({ configured: false });
    expect(
      await clientWith(() =>
        json(200, { configured: true, kdf: 'K', rec_salt: 'S' }),
      ).client.params(),
    ).toEqual({ configured: true, kdf: 'K', recSalt: 'S' });
    const { client, calls } = clientWith(() =>
      json(200, { vault_id: 'v', kdf: 'k', mk_version: 1, key_revision: 2, wrapped_mk_pw: 'w' }),
    );
    expect(await client.login('secreto')).toEqual({
      vaultId: 'v',
      kdf: 'k',
      mkVersion: 1,
      keyRevision: 2,
      wrappedMkPw: 'w',
    });
    expect(calls[0]?.url).toBe('/api/auth/login');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ auth_pw: 'secreto' });
    expect(calls[0]?.init.credentials).toBe('same-origin');
    expect(calls[0]?.init.redirect).toBe('error');
    expect(calls[0]?.init.cache).toBe('no-store');
  });

  it('cerrar sesión nunca lanza', async () => {
    await createAuthClient({
      fetch: (() => Promise.reject(new TypeError('x'))) as typeof fetch,
    }).logout();
    const { client, calls } = clientWith(() => new Response(null, { status: 204 }));
    await client.logout();
    expect(calls[0]?.url).toBe('/api/auth/logout');
  });
});
