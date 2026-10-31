/**
 * Operaciones irreversibles de Configuración (H8.3b): borrar todos los recuerdos y eliminar el espacio.
 * Las dos piden la contraseña ACTUAL; se envía solo su prueba derivada (`auth_pw`), nunca la contraseña.
 * El servidor trabaja por tandas (`done: false` ⇒ se repite la misma petición) y repetirla es seguro.
 *
 * Respuesta perdida: borrar los recuerdos se reintenta sin más (es idempotente). Al eliminar el espacio, si la respuesta se
 * pierde, se mira `params`: si ya no hay espacio, la operación se aplicó.
 */
import { disposeMaterial, preparePassword } from '@/lib/crypto';
import { AccessError, fromAuth, readStatus, type Tuning } from './access-flow';
import { AuthError, type AuthClient } from './auth-client';

const MAX_ROUNDS = 200;

async function proofOf(client: AuthClient, password: string, tuning: Tuning): Promise<string> {
  const status = await readStatus(client);
  if (!status.configured) throw new AccessError('unavailable');
  try {
    const material = await preparePassword(password, status.kdf, tuning.vault?.policy);
    const authPw = material.authPw;
    disposeMaterial(material);
    return authPw;
  } catch {
    throw new AccessError('insecure_params');
  }
}

async function untilDone(
  step: () => Promise<{ readonly done: boolean }>,
  appliedAfterLoss: () => Promise<boolean>,
  onRound?: (round: number) => void,
): Promise<void> {
  let losses = 0;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    onRound?.(round);
    try {
      if ((await step()).done) return;
      continue;
    } catch (error) {
      const lost = error instanceof AuthError && error.code === 'unavailable';
      if (lost && (await appliedAfterLoss().catch(() => false))) return;
      if (!lost || ++losses > 2) throw fromAuth(error);
    }
  }
  throw new AccessError('unavailable');
}

/** Borra PARA SIEMPRE todos los recuerdos y sus fotos (también la papelera). Ajustes, avatar y sesión se quedan. */
export async function deleteAllMemories(
  client: AuthClient,
  password: string,
  tuning: Tuning = {},
  onRound?: (round: number) => void,
): Promise<void> {
  const authPw = await proofOf(client, password, tuning);
  await untilDone(
    () => client.purgeAllMemories(authPw),
    async () => false,
    onRound,
  );
}

/** Elimina el espacio entero. Al volver, la sesión ya no existe: hay que soltar las claves y salir. */
export async function deleteWholeSpace(
  client: AuthClient,
  password: string,
  tuning: Tuning = {},
  onRound?: (round: number) => void,
): Promise<void> {
  const authPw = await proofOf(client, password, tuning);
  await untilDone(
    () => client.deleteSpace(authPw),
    async () => !(await readStatus(client)).configured,
    onRound,
  );
}
