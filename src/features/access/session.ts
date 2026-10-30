/**
 * Sesión desbloqueada de esta pestaña: UNA fuente de datos con las claves en memoria (D-054, D-069).
 * Nada de esto se guarda en el navegador: recargar la página, abrir otra pestaña o bloquear suelta las claves.
 */
import type { GardenSource } from '@/features/calendar';
import { createSettingsSource, type SettingsSource } from '@/lib/settings';
import type { Keyring } from '@/lib/crypto';
import { createRemoteRepository } from '@/lib/remote/remote-repository';
import type { Repository } from '@/lib/storage/types';
import { createGardenSource } from './garden-source';

export type LockReason = 'expired' | 'idle' | 'manual';

let source: GardenSource | null = null;
let settings: SettingsSource | null = null;
const listeners = new Set<(reason: LockReason) => void>();

/** Crea la fuente de datos con las claves recién obtenidas. `repository` solo lo usan las pruebas. */
export function installSource(keyring: Keyring, repository?: Repository): GardenSource {
  lockSession();
  const repo =
    repository ??
    createRemoteRepository({
      // 401: la sesión caducó (o se cerró en otro sitio). Con claves en memoria pero sin sesión no hay nada que hacer: a entrar de nuevo.
      onUnauthorized: () => lockSession('expired'),
    });
  source = createGardenSource(repo, keyring);
  settings = createSettingsSource(repo, keyring); // mismas claves y mismo repositorio: un solo bloqueo para todo
  return source;
}

export function currentSource(): GardenSource | null {
  return source;
}

export function currentSettingsSource(): SettingsSource | null {
  return settings;
}

/** Suelta las claves y las imágenes descifradas. Con `reason`, avisa a quien escuche (la pantalla vuelve al acceso). */
export function lockSession(reason?: LockReason): void {
  const current = source;
  source = null;
  settings?.lock();
  settings = null;
  current?.lock();
  if (reason && current) for (const listener of [...listeners]) listener(reason);
}

export function onLock(listener: (reason: LockReason) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
