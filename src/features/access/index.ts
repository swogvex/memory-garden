/** Interfaz pública de la feature de acceso (primer acceso, entrada, recuperación y bloqueo). */
export { default as AccessGate } from './AccessGate.svelte';
export { default as SignOut } from './SignOut.svelte';
export { default as SecuritySection } from './SecuritySection.svelte';
export {
  currentSettingsSource,
  currentSource,
  lockSession,
  onLock,
  type LockReason,
} from './session';
