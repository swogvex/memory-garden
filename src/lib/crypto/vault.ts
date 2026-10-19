import { b64uDecode, b64uEncode, randomBytes, zero } from './bytes';
import type { Bytes } from './bytes';
import { MK_BYTES, PRODUCTION_KDF_POLICY, PURPOSE, REC_SALT_BYTES } from './constants';
import type { KdfPolicy } from './constants';
import { ctxWrapPw, ctxWrapRec } from './contexts';
import { open, seal } from './envelope';
import { CryptoError } from './errors';
import { newId } from './ids';
import { canonicalKdf, derivePasswordSecrets, newKdfParams, parseKdf } from './kdf';
import type { DerivedSecrets } from './kdf';
import { Keyring } from './keyring';
import { assertPasswordPolicy } from './password-policy';
import { deriveRecoverySecrets, generateRecoveryKey, parseRecoveryKey } from './recovery-key';

/**
 * Flujos de clave de crypto-spec.md §8. Este módulo NO habla con el servidor: devuelve lo que habría que enviarle.
 *
 * CORRECCIÓN A LA ESPECIFICACIÓN (propuesta S-1): la MK del Keyring es no extraíble, así que cambiar la contraseña,
 * regenerar la clave de recuperación o actualizar el KDF desenvuelve la MK de forma TRANSITORIA con la contraseña
 * actual (que esos flujos ya exigen como prueba) y la pone a cero al terminar.
 */

/** Lo que el servidor guarda del espacio (no secreto, salvo que las envolturas sólo abren con credenciales). */
export interface VaultWire {
  readonly vaultId: string;
  /** JSON canónico del registro KDF. */
  readonly kdf: string;
  readonly mkVersion: number;
  readonly wrappedMkPw: string;
  readonly recSalt: string;
  readonly wrappedMkRec: string;
}

export interface Options {
  /** SOLO pruebas. La interfaz nunca debe pasarla: sin ella se aplica la política de producción. */
  readonly policy?: KdfPolicy;
  /** iter para espacios nuevos o actualizados; por defecto `policy.targetIter`. */
  readonly iter?: number;
}

const kekOf = new WeakMap<object, CryptoKey>();

/** Prueba de contraseña lista para enviar + clave de envoltura (opaca, no extraíble). */
export interface PasswordMaterial {
  readonly authPw: string;
  readonly kdf: string;
}
/** Prueba de clave de recuperación + clave de envoltura (opaca). */
export interface RecoveryMaterial {
  readonly authRec: string;
  readonly recSalt: string;
}

function register<T extends object>(obj: T, secrets: DerivedSecrets): T {
  kekOf.set(obj, secrets.kek);
  zero(secrets.auth);
  return obj;
}
function kek(m: object): CryptoKey {
  const k = kekOf.get(m);
  if (!k) throw new CryptoError('invalid_input');
  return k;
}

/**
 * Suelta la clave de envoltura asociada a un material de contraseña o de recuperación. Llamar en cuanto deje de
 * hacer falta (tras desbloquear, o al cerrar sesión): después el material ya no sirve para desenvolver nada.
 * JavaScript no permite borrar una `CryptoKey`; se elimina la única referencia que guarda este módulo.
 */
export function disposeMaterial(m: PasswordMaterial | RecoveryMaterial): void {
  kekOf.delete(m);
}

/** §8.2 paso 2: valida el registro KDF (suelo/techo) y deriva. Con parámetros inaceptables aborta ANTES de derivar. */
export async function preparePassword(
  password: string,
  kdfJson: string,
  policy?: KdfPolicy,
): Promise<PasswordMaterial> {
  const params = parseKdf(kdfJson, policy ?? PRODUCTION_KDF_POLICY);
  const s = await derivePasswordSecrets(password, params);
  const authPw = b64uEncode(s.auth);
  return register({ authPw, kdf: kdfJson }, s);
}

/** §8.4 paso 1-2: lee y comprueba la clave (CRC local) y deriva. Los errores de tecleo salen sin consultar al servidor. */
export async function prepareRecovery(
  recoveryKeyInput: string,
  recSalt: string,
): Promise<RecoveryMaterial> {
  const ikm = parseRecoveryKey(recoveryKeyInput);
  try {
    const s = await deriveRecoverySecrets(ikm, recSalt);
    const authRec = b64uEncode(s.auth);
    return register({ authRec, recSalt }, s);
  } finally {
    zero(ikm);
  }
}

async function mkFromPassword(m: PasswordMaterial, v: VaultWire): Promise<Bytes> {
  if (m.kdf !== v.kdf) throw new CryptoError('invalid_input');
  const { plaintext } = await open(
    kek(m),
    b64uDecode(v.wrappedMkPw),
    PURPOSE.wrapPw,
    ctxWrapPw(v.vaultId, v.kdf),
  );
  if (plaintext.length !== MK_BYTES) throw new CryptoError('decrypt_failed');
  return plaintext;
}
async function mkFromRecovery(m: RecoveryMaterial, v: VaultWire): Promise<Bytes> {
  if (m.recSalt !== v.recSalt) throw new CryptoError('invalid_input');
  const { plaintext } = await open(
    kek(m),
    b64uDecode(v.wrappedMkRec),
    PURPOSE.wrapRec,
    ctxWrapRec(v.vaultId, v.recSalt),
  );
  if (plaintext.length !== MK_BYTES) throw new CryptoError('decrypt_failed');
  return plaintext;
}

async function keyringFrom(
  mk: Bytes,
  v: Pick<VaultWire, 'vaultId' | 'mkVersion'>,
): Promise<Keyring> {
  try {
    return await Keyring.fromMasterKey(mk, v.vaultId, v.mkVersion);
  } finally {
    zero(mk);
  }
}

/** §8.2 paso 4: desenvuelve la MK con la contraseña. Contraseña incorrecta ⇒ `decrypt_failed`. */
export async function unwrapWithPassword(m: PasswordMaterial, v: VaultWire): Promise<Keyring> {
  return keyringFrom(await mkFromPassword(m, v), v);
}
/** §8.4 paso 4. */
export async function unwrapWithRecovery(m: RecoveryMaterial, v: VaultWire): Promise<Keyring> {
  return keyringFrom(await mkFromRecovery(m, v), v);
}

interface NewPasswordBlock {
  readonly kdf: string;
  readonly authPw: string;
  readonly wrappedMkPw: string;
}
async function wrapForPassword(
  mk: Uint8Array,
  vaultId: string,
  password: string,
  o: Options,
): Promise<NewPasswordBlock> {
  const policy = o.policy ?? PRODUCTION_KDF_POLICY;
  const params = newKdfParams(policy, o.iter ?? policy.targetIter);
  const kdf = canonicalKdf(params);
  const s = await derivePasswordSecrets(password, params);
  const wrapped = await seal(s.kek, mk, PURPOSE.wrapPw, 0, ctxWrapPw(vaultId, kdf));
  const authPw = b64uEncode(s.auth);
  zero(s.auth);
  return { kdf, authPw, wrappedMkPw: b64uEncode(wrapped) };
}

interface NewRecoveryBlock {
  readonly recoveryKey: string;
  readonly recSalt: string;
  readonly authRec: string;
  readonly wrappedMkRec: string;
}
async function wrapForRecovery(mk: Uint8Array, vaultId: string): Promise<NewRecoveryBlock> {
  const key = generateRecoveryKey();
  const recSalt = b64uEncode(randomBytes(REC_SALT_BYTES));
  try {
    const s = await deriveRecoverySecrets(key.ikm, recSalt);
    const wrapped = await seal(s.kek, mk, PURPOSE.wrapRec, 0, ctxWrapRec(vaultId, recSalt));
    const authRec = b64uEncode(s.auth);
    zero(s.auth);
    return { recoveryKey: key.display, recSalt, authRec, wrappedMkRec: b64uEncode(wrapped) };
  } finally {
    zero(key.ikm);
  }
}

export interface CreatedVault extends NewRecoveryBlock {
  readonly wire: VaultWire;
  readonly authPw: string;
  readonly keyring: Keyring;
}

/** §8.1 pasos 2-4. El llamador debe mostrar la clave de recuperación y exigir que se reescriba ANTES de enviar nada. */
export async function createVault(password: string, o: Options = {}): Promise<CreatedVault> {
  assertPasswordPolicy(password);
  const vaultId = newId();
  const mk = randomBytes(MK_BYTES);
  try {
    const pw = await wrapForPassword(mk, vaultId, password, o);
    const rec = await wrapForRecovery(mk, vaultId);
    const wire: VaultWire = {
      vaultId,
      kdf: pw.kdf,
      mkVersion: 1,
      wrappedMkPw: pw.wrappedMkPw,
      recSalt: rec.recSalt,
      wrappedMkRec: rec.wrappedMkRec,
    };
    const keyring = await Keyring.fromMasterKey(mk, vaultId, 1);
    return { ...rec, wire, authPw: pw.authPw, keyring };
  } finally {
    zero(mk);
  }
}

export interface PasswordChange extends NewPasswordBlock {
  /** Prueba de la contraseña ACTUAL para el servidor (`current_auth_pw`). */
  readonly currentAuthPw: string;
}

/** §8.3: solo reenvuelve. No cambia la MK, la clave de recuperación ni los datos. */
export async function changePassword(
  current: PasswordMaterial,
  v: VaultWire,
  newPassword: string,
  o: Options = {},
): Promise<PasswordChange> {
  assertPasswordPolicy(newPassword);
  return rewrapPassword(current, v, newPassword, o);
}

/** §8.6: misma contraseña, parámetros y sal nuevos. No aplica la política de contraseña (ya está en uso). */
export async function upgradeKdf(
  current: PasswordMaterial,
  v: VaultWire,
  password: string,
  o: Options = {},
): Promise<PasswordChange> {
  return rewrapPassword(current, v, password, o);
}

async function rewrapPassword(
  current: PasswordMaterial,
  v: VaultWire,
  password: string,
  o: Options,
): Promise<PasswordChange> {
  const mk = await mkFromPassword(current, v);
  try {
    return {
      ...(await wrapForPassword(mk, v.vaultId, password, o)),
      currentAuthPw: current.authPw,
    };
  } finally {
    zero(mk);
  }
}

export interface RecoveryRegeneration extends NewRecoveryBlock {
  readonly currentAuthPw: string;
}

/** §8.5: clave de recuperación nueva; la anterior deja de valer cuando el servidor confirma el cambio. */
export async function regenerateRecoveryKey(
  current: PasswordMaterial,
  v: VaultWire,
): Promise<RecoveryRegeneration> {
  const mk = await mkFromPassword(current, v);
  try {
    return { ...(await wrapForRecovery(mk, v.vaultId)), currentAuthPw: current.authPw };
  } finally {
    zero(mk);
  }
}

export interface RecoveryReset extends NewPasswordBlock, NewRecoveryBlock {
  readonly keyring: Keyring;
}

/** §8.4 pasos 4-5: contraseña nueva Y clave de recuperación nueva (la usada se da por expuesta). */
export async function resetViaRecovery(
  m: RecoveryMaterial,
  v: VaultWire,
  newPassword: string,
  o: Options = {},
): Promise<RecoveryReset> {
  assertPasswordPolicy(newPassword);
  const mk = await mkFromRecovery(m, v);
  try {
    const pw = await wrapForPassword(mk, v.vaultId, newPassword, o);
    const rec = await wrapForRecovery(mk, v.vaultId);
    const keyring = await Keyring.fromMasterKey(mk, v.vaultId, v.mkVersion);
    return { ...pw, ...rec, keyring };
  } finally {
    zero(mk);
  }
}
