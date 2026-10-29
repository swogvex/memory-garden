/**
 * Sincronización entre dispositivos y conflictos simples (H7.2b, D-178). Funciona con CUALQUIER `Repository`
 * (el de desarrollo o el remoto) y no toca la red ni el almacenamiento: solo usa la interfaz.
 */
import { StorageError } from './errors';
import type { MemoryRecord, PutMemoryInput, Repository } from './types';

export type SaveNotice =
  /** Otro dispositivo había guardado antes: se ha guardado esta versión (la más reciente por `updated_at`). `replaced` permite ofrecer «deshacer». */
  | { readonly kind: 'replaced_remote'; readonly replaced: MemoryRecord }
  /** El recuerdo se movió a la papelera desde otro dispositivo: NO se sobrescribe; la pantalla decide (restaurar o descartar). */
  | { readonly kind: 'remote_trashed'; readonly current: MemoryRecord }
  /** El recuerdo se borró definitivamente desde otro dispositivo. */
  | { readonly kind: 'remote_gone' };

export interface SaveResult {
  /** `null` si no se pudo guardar (ver `notice`). */
  readonly record: MemoryRecord | null;
  readonly notice: SaveNotice | null;
}

/**
 * Guarda con la revisión conocida. Si hay conflicto, lo resuelve así: la versión de ESTE dispositivo es la más reciente
 * (el guardado ocurre ahora, después de lo que ya hay en el servidor), por lo que prevalece, y se AVISA con lo reemplazado.
 * Excepciones: si el servidor ya tiene exactamente lo mismo, no hay nada que avisar; si el recuerdo está en la papelera o
 * ya no existe, no se resucita sin que lo decida la persona. Una sola reintentada: nunca bucles.
 */
export async function saveWithResolution(
  repo: Repository,
  input: PutMemoryInput,
  expectedRevision: number | null,
): Promise<SaveResult> {
  try {
    return { record: await repo.memories.put(input, expectedRevision), notice: null };
  } catch (err) {
    if (!(err instanceof StorageError) || err.code !== 'conflict' || expectedRevision === null)
      throw err;
  }
  const current = await repo.memories.get(input.id);
  if (!current) return { record: null, notice: { kind: 'remote_gone' } };
  if (current.deletedAt !== null)
    return { record: null, notice: { kind: 'remote_trashed', current } };
  if (current.payload === input.payload) return { record: current, notice: null };
  const record = await repo.memories.put(input, current.revision); // si vuelve a fallar, el error sube a la pantalla
  return { record, notice: { kind: 'replaced_remote', replaced: current } };
}

export interface SyncState {
  /** Marca de «lo último visto»; empezar en `-1` trae todo. */
  readonly cursor: number;
}

export interface SyncResult {
  readonly changes: readonly MemoryRecord[];
  readonly state: SyncState;
}

/**
 * Trae lo cambiado desde la última sincronización, papelera incluida (para que un borrado en otro dispositivo se vea).
 * El servidor trabaja en segundos y el contrato es «estrictamente posterior»: se retrocede 1 s para no perder cambios que
 * lleguen en el mismo segundo que el último visto. Los repetidos son inofensivos (se identifican por `id` y `revision`).
 */
export async function pullChanges(repo: Repository, state: SyncState): Promise<SyncResult> {
  const changes = await repo.memories.list({
    since: state.cursor < 0 ? -1 : state.cursor - 1,
    includeTrashed: true,
  });
  const newest = changes.reduce((n, m) => Math.max(n, m.updatedAt), state.cursor);
  return { changes, state: { cursor: newest } };
}
