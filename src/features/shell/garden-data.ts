import {
  currentBackupSource,
  currentSettingsSource,
  currentSource,
  lockSession,
} from '@/features/access';
import { GardenUnavailableError, type GardenSource } from '@/features/calendar';
import type { BackupSource } from '@/lib/backup';
import type { SettingsSource } from '@/lib/settings';

interface Space {
  readonly garden: GardenSource;
  readonly settings: SettingsSource;
  readonly backup: BackupSource;
}

let pending: Promise<Space> | null = null;

async function load(): Promise<Space> {
  // Solo desarrollo. En producción Vite sustituye DEV por `false` y esta rama (y la semilla) desaparece del bundle.
  if (import.meta.env.DEV) {
    const { createDevSpace } = await import('../../dev/seed');
    return createDevSpace();
  }
  throw new GardenUnavailableError();
}

function devSpace(): Promise<Space> {
  pending ??= load().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

/**
 * La fuente real aparece cuando el acceso desbloquea (H7.3): es la de `features/access`, con las claves en memoria.
 * Se consulta en cada llamada para no devolver nunca una fuente ya bloqueada tras volver a entrar.
 */
export function openGardenSource(): Promise<GardenSource> {
  const unlocked = currentSource();
  if (unlocked) return Promise.resolve(unlocked);
  return devSpace().then((space) => space.garden);
}

/** Fuente de Configuración (H8.1): la misma sesión y las mismas claves que el Jardín. */
export function openSettingsSource(): Promise<SettingsSource> {
  const unlocked = currentSettingsSource();
  if (unlocked) return Promise.resolve(unlocked);
  return devSpace().then((space) => space.settings);
}

/** Copia cifrada (H8.3): exportar y continuar una restauración, con las mismas claves. */
export function openBackupSource(): Promise<BackupSource> {
  const unlocked = currentBackupSource();
  if (unlocked) return Promise.resolve(unlocked);
  return devSpace().then((space) => space.backup);
}

/** Suelta las claves y fuerza a reabrir la próxima vez (D-082). */
export function lockGarden(): void {
  const current = pending;
  pending = null;
  lockSession();
  void current?.then(
    (space) => {
      space.settings.lock();
      space.garden.lock();
    },
    () => undefined,
  );
}
