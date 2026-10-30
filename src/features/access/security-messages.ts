import type { MessageKey } from '@/lib/i18n';
import { AccessError } from './access-flow';

/** Mensaje de un fallo al cambiar la contraseña o la clave de recuperación. Nunca con datos del servidor. */
export function securityErrorKey(error: unknown): MessageKey {
  if (!(error instanceof AccessError)) return 'security.error.generic';
  switch (error.code) {
    case 'wrong_credentials':
      return 'security.password.error.current';
    case 'rate_limited':
      return 'access.error.wait';
    case 'session_expired':
      return 'security.error.expired';
    case 'conflict':
      return 'security.error.conflict';
    case 'unavailable':
      return 'access.error.network';
    case 'insecure_params':
      return 'access.error.unsafe';
    case 'policy':
      return 'access.error.policy';
    default:
      return 'security.error.generic';
  }
}
