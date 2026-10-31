/**
 * Lista grande de contraseñas comunes (D-122). Pesa decenas de KB: se descarga aparte (como la lista de palabras de la
 * frase de paso, D-203) solo en las pantallas que piden una contraseña nueva. Sin red externa: es un archivo del propio sitio.
 */
import type { CommonPasswordData } from '@/lib/crypto';

let pending: Promise<CommonPasswordData> | null = null;

function loadCommonPasswords(): Promise<CommonPasswordData> {
  pending ??= import('@/lib/crypto/common-passwords')
    .then((m) => ({ long: new Set(m.COMMON_LONG), base: new Set(m.COMMON_BASE) }))
    .catch((error: unknown) => {
      pending = null; // se reintentará la próxima vez
      throw error;
    });
  return pending;
}

/** Igual que `loadCommonPasswords`, pero sin lista si no se pudo cargar (la política básica sigue aplicándose). */
export async function commonPasswordsOrNull(): Promise<CommonPasswordData | null> {
  try {
    return await loadCommonPasswords();
  } catch {
    return null;
  }
}
