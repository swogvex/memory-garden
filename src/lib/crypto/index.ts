/** API pública de lib/crypto. Las funciones de prueba (sealWithNonce) NO se exportan aquí. */
export { CryptoError } from './errors';
export type { CryptoErrorCode } from './errors';
export {
  PRODUCTION_KDF_POLICY,
  MIN_PASSWORD_LENGTH,
  MAX_CONTENT_BYTES,
  ENVELOPE_OVERHEAD,
} from './constants';
export type { KdfPolicy } from './constants';
export { newId, isId } from './ids';
export { b64uEncode, b64uDecode } from './bytes';
export { parseKdf, kdfNeedsUpgrade } from './kdf';
export type { KdfParams } from './kdf';
export {
  generateRecoveryKey,
  parseRecoveryKey,
  isRecoveryKeyWellFormed,
  normalizeRecoveryInput,
} from './recovery-key';
export { checkPasswordPolicy, assertPasswordPolicy, generatePassphrase } from './password-policy';
export { Keyring } from './keyring';
export {
  createVault,
  preparePassword,
  prepareRecovery,
  unwrapWithPassword,
  unwrapWithRecovery,
  changePassword,
  upgradeKdf,
  regenerateRecoveryKey,
  resetViaRecovery,
  disposeMaterial,
} from './vault';
export type {
  VaultWire,
  PasswordMaterial,
  RecoveryMaterial,
  CreatedVault,
  PasswordChange,
  RecoveryRegeneration,
  RecoveryReset,
  Options as VaultOptions,
} from './vault';
export type { Passphrase } from './password-policy';
export { generateSpanishPassphrase, PASSPHRASE_WORDS_ES } from './passphrase-es';
export { WORDLIST_ES } from './wordlist-es';
