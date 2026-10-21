import { GardenUnavailableError, type GardenSource } from '@/features/calendar';

let pending: Promise<GardenSource> | null = null;

async function load(): Promise<GardenSource> {
  // Solo desarrollo. En producción Vite sustituye DEV por `false` y esta rama (y la semilla) desaparece del bundle.
  if (import.meta.env.DEV) {
    const { createDevGardenSource } = await import('../../dev/seed');
    return createDevGardenSource();
  }
  // H7: aquí irán el adaptador remoto y el desbloqueo con contraseña.
  throw new GardenUnavailableError();
}

export function openGardenSource(): Promise<GardenSource> {
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
  void current?.then(
    (source) => source.lock(),
    () => undefined,
  );
}
