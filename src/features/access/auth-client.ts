/**
 * Cliente de los puntos de autenticación del Worker (`/api/auth/*`, `/api/setup`, `/api/vault/*`).
 * Solo envía secretos DERIVADOS (`auth_pw`, `auth_rec`) y envolturas cifradas: nunca la contraseña ni la clave de recuperación.
 * Sin consola, sin almacenamiento del navegador. Errores con mensaje fijo (`auth:<código>`), sin datos del servidor.
 */
export type AuthErrorCode =
  /** 401 de credenciales (o código de primer acceso incorrecto): misma respuesta para todo (PS-22). */
  | 'invalid_credentials'
  /** 429: demasiados intentos; `retryAfter` en segundos. */
  | 'rate_limited'
  /** 401 sin sesión válida (caducó, o no hay). */
  | 'unauthorized'
  /** 409: otro dispositivo cambió las claves a la vez. */
  | 'conflict'
  /** 400/403/404/413/415: el servidor rechaza la forma de la petición. */
  | 'rejected'
  /** Red caída, tiempo agotado, 5xx o respuesta inesperada. */
  | 'unavailable';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly retryAfter: number | null;
  constructor(code: AuthErrorCode, retryAfter: number | null = null) {
    super(`auth:${code}`);
    this.name = 'AuthError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export type AuthParams =
  | { readonly configured: false }
  | { readonly configured: true; readonly kdf: string; readonly recSalt: string };

export interface SetupRequest {
  readonly setupCode: string;
  readonly vaultId: string;
  readonly kdf: string;
  readonly authPw: string;
  readonly recSalt: string;
  readonly authRec: string;
  readonly wrappedMkPw: string;
  readonly wrappedMkRec: string;
  readonly mkVersion: number;
}

interface LoginReply {
  readonly vaultId: string;
  readonly kdf: string;
  readonly mkVersion: number;
  readonly keyRevision: number;
  readonly wrappedMkPw: string;
}

interface RecoverReply {
  readonly vaultId: string;
  readonly mkVersion: number;
  readonly keyRevision: number;
  readonly recSalt: string;
  readonly wrappedMkRec: string;
}

interface RecoveryResetRequest {
  readonly kdf: string;
  readonly authPw: string;
  readonly wrappedMkPw: string;
  readonly recSalt: string;
  readonly authRec: string;
  readonly wrappedMkRec: string;
  readonly expectedKeyRevision: number;
}

interface KdfUpgradeRequest {
  readonly currentAuthPw: string;
  readonly kdf: string;
  readonly authPw: string;
  readonly wrappedMkPw: string;
  readonly expectedKeyRevision: number;
}

interface PasswordChangeRequest {
  readonly currentAuthPw: string;
  readonly kdf: string;
  readonly authPw: string;
  readonly wrappedMkPw: string;
  readonly expectedKeyRevision: number;
}

interface RecoveryKeyRequest {
  readonly currentAuthPw: string;
  readonly recSalt: string;
  readonly authRec: string;
  readonly wrappedMkRec: string;
  readonly expectedKeyRevision: number;
}

export interface AuthClient {
  params(): Promise<AuthParams>;
  setup(request: SetupRequest): Promise<{ readonly keyRevision: number }>;
  login(authPw: string): Promise<LoginReply>;
  recover(authRec: string): Promise<RecoverReply>;
  recoveryReset(request: RecoveryResetRequest): Promise<{ readonly keyRevision: number }>;
  upgradeKdf(request: KdfUpgradeRequest): Promise<{ readonly keyRevision: number }>;
  /** Cambio de contraseña (crypto-spec §8.3): el servidor revoca las demás sesiones y renueva la cookie. */
  changePassword(request: PasswordChangeRequest): Promise<{ readonly keyRevision: number }>;
  /** Clave de recuperación nueva (crypto-spec §8.5): la anterior deja de valer al confirmarse. */
  regenerateRecoveryKey(request: RecoveryKeyRequest): Promise<{ readonly keyRevision: number }>;
  /** Borra para siempre todos los recuerdos. `done = false`: queda trabajo, repetir la misma petición. */
  purgeAllMemories(currentAuthPw: string): Promise<{ readonly done: boolean }>;
  /** Elimina el espacio entero y gasta el código de configuración. Igual que el anterior con `done`. */
  deleteSpace(currentAuthPw: string): Promise<{ readonly done: boolean }>;
  /** Mejor esfuerzo: nunca lanza. */
  logout(): Promise<void>;
}

export interface AuthClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** Tiempo máximo por petición (ms). */
  readonly timeoutMs?: number;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function retryAfterOf(res: Response, body: unknown): number {
  const fromBody = isObject(body) && typeof body.retry_after === 'number' ? body.retry_after : NaN;
  const fromHeader = Number(res.headers.get('Retry-After'));
  const n = Number.isFinite(fromBody) ? fromBody : Number.isFinite(fromHeader) ? fromHeader : 5;
  return Math.min(Math.max(Math.ceil(n), 1), 3600);
}

export function createAuthClient(options: AuthClientOptions = {}): AuthClient {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = options.baseUrl ?? '';
  const timeout = options.timeoutMs ?? 20_000;

  /** Devuelve el cuerpo JSON de una respuesta 200 o lanza el `AuthError` que corresponda. */
  async function call(method: 'GET' | 'POST' | 'PUT', path: string, body?: Json): Promise<Json> {
    let res: Response;
    try {
      res = await doFetch(base + path, {
        method,
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new AuthError('unavailable');
    }
    let payload: unknown;
    try {
      payload = res.status === 204 ? null : await res.json();
    } catch {
      payload = null;
    }
    if (res.status === 200 && isObject(payload)) return payload;
    const code = isObject(payload) && typeof payload.error === 'string' ? payload.error : '';
    if (res.status === 401)
      throw new AuthError(code === 'invalid_credentials' ? 'invalid_credentials' : 'unauthorized');
    if (res.status === 429) throw new AuthError('rate_limited', retryAfterOf(res, payload));
    if (res.status === 409) throw new AuthError('conflict');
    if ([400, 403, 404, 411, 413, 415].includes(res.status)) throw new AuthError('rejected');
    throw new AuthError('unavailable');
  }

  const bad = (): never => {
    throw new AuthError('unavailable'); // 200 con forma inesperada: no es el servidor esperado
  };

  return {
    async params() {
      const b = await call('GET', '/api/auth/params');
      if (b.configured === false) return { configured: false };
      if (b.configured === true && isStr(b.kdf) && isStr(b.rec_salt)) {
        return { configured: true, kdf: b.kdf, recSalt: b.rec_salt };
      }
      return bad();
    },

    async setup(r) {
      const b = await call('POST', '/api/setup', {
        setup_code: r.setupCode,
        vault_id: r.vaultId,
        kdf: r.kdf,
        auth_pw: r.authPw,
        rec_salt: r.recSalt,
        auth_rec: r.authRec,
        wrapped_mk_pw: r.wrappedMkPw,
        wrapped_mk_rec: r.wrappedMkRec,
        mk_version: r.mkVersion,
      });
      return isInt(b.key_revision) ? { keyRevision: b.key_revision } : bad();
    },

    async login(authPw) {
      const b = await call('POST', '/api/auth/login', { auth_pw: authPw });
      if (
        isStr(b.vault_id) &&
        isStr(b.kdf) &&
        isInt(b.mk_version) &&
        isInt(b.key_revision) &&
        isStr(b.wrapped_mk_pw)
      ) {
        return {
          vaultId: b.vault_id,
          kdf: b.kdf,
          mkVersion: b.mk_version,
          keyRevision: b.key_revision,
          wrappedMkPw: b.wrapped_mk_pw,
        };
      }
      return bad();
    },

    async recover(authRec) {
      const b = await call('POST', '/api/auth/recover', { auth_rec: authRec });
      if (
        isStr(b.vault_id) &&
        isInt(b.mk_version) &&
        isInt(b.key_revision) &&
        isStr(b.rec_salt) &&
        isStr(b.wrapped_mk_rec)
      ) {
        return {
          vaultId: b.vault_id,
          mkVersion: b.mk_version,
          keyRevision: b.key_revision,
          recSalt: b.rec_salt,
          wrappedMkRec: b.wrapped_mk_rec,
        };
      }
      return bad();
    },

    async recoveryReset(r) {
      const b = await call('PUT', '/api/vault/recovery-reset', {
        kdf: r.kdf,
        auth_pw: r.authPw,
        wrapped_mk_pw: r.wrappedMkPw,
        rec_salt: r.recSalt,
        auth_rec: r.authRec,
        wrapped_mk_rec: r.wrappedMkRec,
        expected_key_revision: r.expectedKeyRevision,
      });
      return isInt(b.key_revision) ? { keyRevision: b.key_revision } : bad();
    },

    async upgradeKdf(r) {
      const b = await call('PUT', '/api/vault/kdf', {
        current_auth_pw: r.currentAuthPw,
        kdf: r.kdf,
        auth_pw: r.authPw,
        wrapped_mk_pw: r.wrappedMkPw,
        expected_key_revision: r.expectedKeyRevision,
      });
      return isInt(b.key_revision) ? { keyRevision: b.key_revision } : bad();
    },

    async changePassword(r) {
      const b = await call('PUT', '/api/vault/password', {
        current_auth_pw: r.currentAuthPw,
        kdf: r.kdf,
        auth_pw: r.authPw,
        wrapped_mk_pw: r.wrappedMkPw,
        expected_key_revision: r.expectedKeyRevision,
      });
      return isInt(b.key_revision) ? { keyRevision: b.key_revision } : bad();
    },

    async regenerateRecoveryKey(r) {
      const b = await call('PUT', '/api/vault/recovery-key', {
        current_auth_pw: r.currentAuthPw,
        rec_salt: r.recSalt,
        auth_rec: r.authRec,
        wrapped_mk_rec: r.wrappedMkRec,
        expected_key_revision: r.expectedKeyRevision,
      });
      return isInt(b.key_revision) ? { keyRevision: b.key_revision } : bad();
    },

    async purgeAllMemories(currentAuthPw) {
      const b = await call('POST', '/api/vault/purge-memories', { current_auth_pw: currentAuthPw });
      return typeof b.done === 'boolean' ? { done: b.done } : bad();
    },

    async deleteSpace(currentAuthPw) {
      const b = await call('POST', '/api/vault/delete', { current_auth_pw: currentAuthPw });
      return typeof b.done === 'boolean' ? { done: b.done } : bad();
    },

    async logout() {
      try {
        await doFetch(base + '/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(timeout),
        });
      } catch {
        /* mejor esfuerzo */
      }
    },
  };
}
