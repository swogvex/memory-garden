/**
 * Seguridad desde Configuración (H8.2): cambiar la contraseña y generar una clave de recuperación nueva
 * (crypto-spec.md §8.3 y §8.5). Ninguno de los dos vuelve a cifrar los recuerdos: la clave maestra no cambia, solo cambia
 * la «envoltura» con la que se abre. Por eso los datos siguen abriéndose igual y no hay nada que migrar.
 *
 * Ambos piden la contraseña ACTUAL: se prueba con el mismo acceso de siempre (`login`, con su límite de intentos),
 * que además entrega la envoltura vigente y la revisión de claves para la concurrencia (409 si otro dispositivo cambió algo).
 *
 * Respuesta perdida: si el servidor aplicó el cambio pero la respuesta no llegó, se comprueba con `params` (que muestra el
 * KDF y la sal de recuperación vigentes) si lo que hay es lo nuestro. Así nunca se dice «no se cambió» cuando sí se cambió,
 * que con la clave de recuperación sería grave (la anterior ya no valdría).
 */
import {
  changePassword,
  disposeMaterial,
  preparePassword,
  regenerateRecoveryKey,
  type PasswordMaterial,
  type VaultWire,
} from '@/lib/crypto';
import { AccessError, fromAuth, readStatus, type Tuning } from './access-flow';
import { AuthError, type AuthClient } from './auth-client';
import { commonPasswordsOrNull } from './common-list';
import { passwordIssues } from './setup-model';

interface Proven {
  readonly material: PasswordMaterial;
  readonly wire: VaultWire;
  readonly keyRevision: number;
}

/** Prueba la contraseña actual ante el servidor y devuelve lo necesario para reenvolver. El llamador suelta `material`. */
async function prove(client: AuthClient, current: string, tuning: Tuning): Promise<Proven> {
  const status = await readStatus(client);
  if (!status.configured) throw new AccessError('unavailable');
  let material: PasswordMaterial;
  try {
    material = await preparePassword(current, status.kdf, tuning.vault?.policy);
  } catch {
    throw new AccessError('insecure_params');
  }
  try {
    const reply = await client.login(material.authPw);
    return {
      material,
      keyRevision: reply.keyRevision,
      wire: {
        vaultId: reply.vaultId,
        kdf: reply.kdf,
        mkVersion: reply.mkVersion,
        wrappedMkPw: reply.wrappedMkPw,
        recSalt: status.recSalt,
        wrappedMkRec: '',
      },
    };
  } catch (error) {
    disposeMaterial(material);
    throw fromAuth(error);
  }
}

/**
 * Envía un cambio de claves. Si se pierde la respuesta, mira si el servidor ya tiene lo nuestro (`applied`) y, si no,
 * lo reintenta UNA vez. Un 409 tras una respuesta perdida también se comprueba así antes de darlo por conflicto.
 */
async function sendOnce(
  client: AuthClient,
  send: () => Promise<unknown>,
  applied: () => Promise<boolean>,
): Promise<void> {
  try {
    await send();
    return;
  } catch (error) {
    if (!(error instanceof AuthError) || error.code !== 'unavailable') throw fromAuth(error);
  }
  if (await applied().catch(() => false)) return;
  try {
    await send();
  } catch (error) {
    if (await applied().catch(() => false)) return;
    throw fromAuth(error);
  }
}

/** Cambia la contraseña. La sesión de este dispositivo sigue abierta; las de los demás se cierran. */
export async function changeOwnPassword(
  client: AuthClient,
  current: string,
  next: string,
  tuning: Tuning = {},
): Promise<void> {
  if (passwordIssues(next, undefined, await commonPasswordsOrNull()).length > 0)
    throw new AccessError('policy');
  if (next === current) throw new AccessError('policy');
  const proven = await prove(client, current, tuning);
  try {
    let change;
    try {
      change = await changePassword(proven.material, proven.wire, next, tuning.vault);
    } catch {
      throw new AccessError('unwrap_failed');
    }
    await sendOnce(
      client,
      () =>
        client.changePassword({
          currentAuthPw: change.currentAuthPw,
          kdf: change.kdf,
          authPw: change.authPw,
          wrappedMkPw: change.wrappedMkPw,
          expectedKeyRevision: proven.keyRevision,
        }),
      async () => {
        const now = await client.params();
        return now.configured && now.kdf === change.kdf; // sal nueva: solo coincide si es el nuestro
      },
    );
  } finally {
    disposeMaterial(proven.material);
  }
}

export interface PendingRecoveryKey {
  /** La clave NUEVA: mostrar una vez y pedir que se reescriba ANTES de `activate`. La anterior sigue valiendo hasta entonces. */
  readonly recoveryKey: string;
  /** Activa la clave nueva en el servidor. Reintentable si falla la red. */
  activate(): Promise<void>;
  /** Abandona sin cambiar nada. */
  discard(): void;
}

/** Prepara una clave de recuperación nueva en este dispositivo. No envía nada todavía. */
export async function beginRecoveryKeyRotation(
  client: AuthClient,
  current: string,
  tuning: Tuning = {},
): Promise<PendingRecoveryKey> {
  const proven = await prove(client, current, tuning);
  let regen;
  try {
    regen = await regenerateRecoveryKey(proven.material, proven.wire);
  } catch {
    throw new AccessError('unwrap_failed');
  } finally {
    disposeMaterial(proven.material);
  }
  let done = false;
  let discarded = false;
  return {
    recoveryKey: regen.recoveryKey,
    async activate() {
      if (discarded) throw new AccessError('unavailable');
      if (done) return;
      await sendOnce(
        client,
        () =>
          client.regenerateRecoveryKey({
            currentAuthPw: regen.currentAuthPw,
            recSalt: regen.recSalt,
            authRec: regen.authRec,
            wrappedMkRec: regen.wrappedMkRec,
            expectedKeyRevision: proven.keyRevision,
          }),
        async () => {
          const now = await client.params();
          return now.configured && now.recSalt === regen.recSalt;
        },
      );
      done = true;
    },
    discard() {
      discarded = true;
    },
  };
}
