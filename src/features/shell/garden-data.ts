import { currentSource, lockSession } from '@/features/access';
import { GardenUnavailableError, type GardenSource } from '@/features/calendar';

let pending: Promise<GardenSource> | null = null;

async function load(): Promise<GardenSource> {
  // Solo desarrollo. En producción Vite sustituye DEV por `false` y esta rama (y la semilla) desaparece del bundle.
  if (import.meta.env.DEV) {
    const { createDevGardenSource } = await import('../../dev/seed');
    return createDevGardenSource();
  }
  throw new GardenUnavailableError();
}

/**
 * La fuente real aparece cuando el acceso desbloquea (H7.3): es la de `features/access`, con las claves en memoria.
 * Se consulta en cada llamada para no devolver nunca una fuente ya bloqueada tras volver a entrar.
 */
export function openGardenSource(): Promise<GardenSource> {
  const unlocked = currentSource();
  if (unlocked) return Promise.resolve(unlocked);
  pending ??= load().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** Suelta las claves y fuerza a reabrir la próxima vez (D-082). */
export function lockGarden(): void {
  const current = pending;
  pending = null;
  lockSession();
  void current?.then(
    (source) => source.lock(),
    () => undefined,
  );
}
