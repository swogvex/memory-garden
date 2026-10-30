/**
 * Flujos de primer acceso, acceso y recuperación (crypto-spec.md §8.1, §8.2, §8.4, §8.6). Une `lib/crypto` con el cliente de
 * autenticación. No toca el DOM ni el almacenamiento del navegador: todo lo que devuelve son claves en memoria (`Keyring`).
 *
 * `tuning` es SOLO para pruebas (pocas iteraciones): las pantallas nunca lo pasan y se aplica la política de producción.
 */
import {
  createVault,
  disposeMaterial,
  kdfNeedsUpgrade,
  prepareRecovery,
  preparePassword,
  resetViaRecovery,
  unwrapWithPassword,
  upgradeKdf,
  type Keyring,
  type RecoveryMaterial,
  type VaultOptions,
  type VaultWire,
} from '@/lib/crypto';
import { AuthError, type AuthClient, type AuthParams } from './auth-client';
import { commonPasswordsOrNull } from './common-list';
import { passwordIssues, recoveryInputState } from './setup-model';

export type AccessFailure =
  /** Contraseña o clave incorrectas (mensaje genérico). */
  | 'wrong_credentials'
  | 'rate_limited'
  | 'unavailable'
  /** El servidor propuso parámetros de cifrado por debajo del suelo (o por encima del techo): no se envía nada. */
  | 'insecure_params'
  /** El servidor aceptó la contraseña pero lo que entregó no abre con ella. */
  | 'unwrap_failed'
  /** Otro dispositivo cambió las claves a la vez. */
  | 'conflict'
  /** Primer acceso rechazado: código incorrecto o el espacio ya existe (no se distingue, PS-07). */
  | 'setup_rejected'
  /** La sesión (de recuperación) caducó. */
  | 'session_expired'
  | 'policy'
  | 'key_format'
  | 'key_checksum';

export class AccessError extends Error {
  readonly code: AccessFailure;
  readonly retryAfter: number | null;
  constructor(code: AccessFailure, retryAfter: number | null = null) {
    super(`access:${code}`);
    this.name = 'AccessError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export interface Tuning {
  /** SOLO pruebas. */
  readonly vault?: VaultOptions;
}

export type SpaceStatus =
  Extract<AuthParams, { configured: true }> | { readonly configured: false };

/** Convierte un fallo de red/servidor en el fallo de acceso correspondiente. */
export function fromAuth(
  error: unknown,
  invalid: AccessFailure = 'wrong_credentials',
): AccessError {
  if (error instanceof AccessError) return error;
  if (error instanceof AuthError) {
    switch (error.code) {
      case 'invalid_credentials':
        return new AccessError(invalid);
      case 'rate_limited':
        return new AccessError('rate_limited', error.retryAfter);
      case 'unauthorized':
        return new AccessError('session_expired');
      case 'conflict':
        return new AccessError('conflict');
      default:
        return new AccessError('unavailable');
    }
  }
  return new AccessError('unavailable');
}

export async function readStatus(client: AuthClient): Promise<SpaceStatus> {
  try {
    return await client.params();
  } catch (error) {
    throw fromAuth(error);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Primer acceso (§8.1)

export interface PendingSpace {
  /** Para mostrar UNA vez (y comprobar que se reescribe) ANTES de enviar nada. */
  readonly recoveryKey: string;
  /** Envía el alta al servidor. Reintentable si falla la red. Devuelve las claves en memoria. */
  submit(setupCode: string): Promise<Keyring>;
  /** Suelta las claves si se abandona el asistente. */
  discard(): void;
}

/** Genera claves y envolturas en este dispositivo. No envía nada. */
export async function beginSetup(
  client: AuthClient,
  password: string,
  tuning: Tuning = {},
): Promise<PendingSpace> {
  if (passwordIssues(password, undefined, await commonPasswordsOrNull()).length > 0)
    throw new AccessError('policy');
  const created = await createVault(password, tuning.vault);
  let keyring: Keyring | null = created.keyring;
  let lostResponse = false;

  const request = (setupCode: string) => ({
    setupCode,
    vaultId: created.wire.vaultId,
    kdf: created.wire.kdf,
    authPw: created.authPw,
    recSalt: created.wire.recSalt,
    authRec: created.authRec,
    wrappedMkPw: created.wire.wrappedMkPw,
    wrappedMkRec: created.wire.wrappedMkRec,
    mkVersion: created.wire.mkVersion,
  });

  return {
    recoveryKey: created.recoveryKey,
    async submit(setupCode) {
      if (!keyring) throw new AccessError('unavailable');
      try {
        await client.setup(request(setupCode));
      } catch (error) {
        const failure = fromAuth(error, 'setup_rejected');
        if (failure.code === 'unavailable') lostResponse = true;
        // Si una petición anterior pudo aplicarse sin que llegara la respuesta, el reintento recibe «rechazado» porque el
        // espacio ya existe. Se comprueba entrando con ESTA contraseña: si el servidor la acepta, el alta era la nuestra.
        if (failure.code === 'setup_rejected' && lostResponse) {
          try {
            await client.login(created.authPw);
          } catch {
            throw failure;
          }
        } else {
          throw failure;
        }
      }
      const ready = keyring;
      keyring = null;
      return ready;
    },
    discard() {
      keyring?.lock();
      keyring = null;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Acceso y desbloqueo (§8.2, §8.6)

export interface Unlocked {
  readonly keyring: Keyring;
}

export async function unlock(
  client: AuthClient,
  status: Extract<SpaceStatus, { configured: true }>,
  password: string,
  tuning: Tuning = {},
): Promise<Unlocked> {
  let material;
  try {
    material = await preparePassword(password, status.kdf, tuning.vault?.policy);
  } catch {
    throw new AccessError('insecure_params'); // suelo/techo del KDF: aborta ANTES de enviar nada (PS-11)
  }
  try {
    let reply;
    try {
      reply = await client.login(material.authPw);
    } catch (error) {
      throw fromAuth(error);
    }
    if (reply.kdf !== status.kdf) throw new AccessError('conflict'); // las claves cambiaron entre dos peticiones
    const wire: VaultWire = {
      vaultId: reply.vaultId,
      kdf: reply.kdf,
      mkVersion: reply.mkVersion,
      wrappedMkPw: reply.wrappedMkPw,
      recSalt: status.recSalt,
      wrappedMkRec: '', // el acceso con contraseña no la necesita
    };
    let keyring: Keyring;
    try {
      keyring = await unwrapWithPassword(material, wire);
    } catch {
      throw new AccessError('unwrap_failed');
    }
    if (kdfNeedsUpgrade(wire.kdf)) {
      // §8.6: transparente y sin interrumpir; si falla se reintenta en el siguiente acceso. Antes de soltar `material`.
      try {
        const up = await upgradeKdf(material, wire, password, tuning.vault);
        await client.upgradeKdf({
          currentAuthPw: up.currentAuthPw,
          kdf: up.kdf,
          authPw: up.authPw,
          wrappedMkPw: up.wrappedMkPw,
          expectedKeyRevision: reply.keyRevision,
        });
      } catch {
        /* sin consecuencias: el espacio sigue funcionando con los parámetros anteriores */
      }
    }
    return { keyring };
  } finally {
    disposeMaterial(material);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Recuperación (§8.4)

export interface PendingReset {
  /** La clave de recuperación NUEVA (la usada se da por expuesta): mostrar una vez y comprobar que se reescribe. */
  readonly recoveryKey: string;
  submit(): Promise<Keyring>;
  discard(): void;
}

export interface RecoverySession {
  /** Con la contraseña nueva, genera credenciales nuevas en este dispositivo (no envía nada todavía). */
  prepareReset(newPassword: string): Promise<PendingReset>;
  discard(): void;
}

/** Comprueba la clave (localmente) y abre la sesión de recuperación (15 min) con el servidor. */
export async function startRecovery(
  client: AuthClient,
  status: Extract<SpaceStatus, { configured: true }>,
  keyInput: string,
  tuning: Tuning = {},
): Promise<RecoverySession> {
  const state = recoveryInputState(keyInput);
  if (state === 'checksum') throw new AccessError('key_checksum');
  if (state !== 'ok') throw new AccessError('key_format');

  let material: RecoveryMaterial | null;
  try {
    material = await prepareRecovery(keyInput, status.recSalt);
  } catch {
    throw new AccessError('key_format');
  }
  let reply;
  try {
    reply = await client.recover(material.authRec);
  } catch (error) {
    disposeMaterial(material);
    throw fromAuth(error);
  }
  const wire: VaultWire = {
    vaultId: reply.vaultId,
    kdf: '', // la recuperación solo usa la envoltura de recuperación
    mkVersion: reply.mkVersion,
    wrappedMkPw: '',
    recSalt: reply.recSalt,
    wrappedMkRec: reply.wrappedMkRec,
  };

  const release = () => {
    if (material) disposeMaterial(material);
    material = null;
  };
  return {
    async prepareReset(newPassword) {
      if (!material) throw new AccessError('unavailable');
      if (passwordIssues(newPassword, undefined, await commonPasswordsOrNull()).length > 0)
        throw new AccessError('policy');
      let reset;
      try {
        reset = await resetViaRecovery(material, wire, newPassword, tuning.vault);
      } catch {
        throw new AccessError('unwrap_failed');
      } finally {
        release();
      }
      let keyring: Keyring | null = reset.keyring;
      return {
        recoveryKey: reset.recoveryKey,
        async submit() {
          if (!keyring) throw new AccessError('unavailable');
          try {
            await client.recoveryReset({
              kdf: reset.kdf,
              authPw: reset.authPw,
              wrappedMkPw: reset.wrappedMkPw,
              recSalt: reset.recSalt,
              authRec: reset.authRec,
              wrappedMkRec: reset.wrappedMkRec,
              expectedKeyRevision: reply.keyRevision,
            });
          } catch (error) {
            throw fromAuth(error);
          }
          const ready = keyring;
          keyring = null;
          return ready;
        },
        discard() {
          keyring?.lock();
          keyring = null;
        },
      };
    },
    discard: release,
  };
}
