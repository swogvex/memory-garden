import type { MessageKey } from '@/lib/i18n';
import type { AccessFailure } from './access-flow';

/** Mensaje (clave de i18n) para cada fallo. Genéricos a propósito: no dicen qué parte falló (PS-22). */
export function failureKey(code: AccessFailure): MessageKey {
  switch (code) {
    case 'wrong_credentials':
      return 'access.error.invalid';
    case 'rate_limited':
      return 'access.error.wait';
    case 'insecure_params':
      return 'access.error.unsafe';
    case 'unwrap_failed':
      return 'access.error.open';
    case 'conflict':
      return 'access.error.conflict';
    case 'setup_rejected':
      return 'setup.error.code';
    case 'session_expired':
      return 'access.error.expired';
    case 'policy':
      return 'access.error.policy';
    case 'key_format':
      return 'key.error.format';
    case 'key_checksum':
      return 'key.error.checksum';
    case 'unavailable':
      return 'access.error.network';
  }
}
