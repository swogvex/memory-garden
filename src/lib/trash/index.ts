/**
 * Papelera (H8.3b; D-058): lo que se mandó a la papelera se puede restaurar o borrar para siempre durante 30 días; después
 * el servidor lo purga solo. Sin interfaz: descifra el título y la fecha para la lista; el servidor nunca los ve.
 */
import type { Keyring } from '@/lib/crypto';
import { StorageError, TRASH_DAYS, type Repository } from '@/lib/storage';
import { parseMemoryPayload } from '@/lib/validation';

export interface TrashItem {
  readonly id: string;
  /** `null` si el recuerdo no se pudo abrir (se puede borrar igualmente). */
  readonly title: string | null;
  /** Fecha del recuerdo (AAAA-MM-DD) o `null`. */
  readonly date: string | null;
  /** Cuándo se mandó a la papelera y cuándo se borrará solo (segundos Unix). */
  readonly deletedAt: number;
  readonly purgeAt: number;
  readonly revision: number;
}

export type TrashErrorCode = 'unavailable' | 'conflict';

export class TrashError extends Error {
  readonly code: TrashErrorCode;
  constructor(code: TrashErrorCode) {
    super(`trash:${code}`);
    this.name = 'TrashError';
    this.code = code;
  }
}

export interface TrashSource {
  list(): Promise<TrashItem[]>;
  /** Vuelve al jardín. `conflict` si otro dispositivo lo cambió (se recarga la lista). */
  restore(item: TrashItem): Promise<void>;
  /** Borra para siempre el recuerdo y sus fotos. Si ya no estaba, no es un error. */
  purge(item: TrashItem): Promise<void>;
}

const wrap = (error: unknown): TrashError =>
  error instanceof StorageError && (error.code === 'conflict' || error.code === 'not_found')
    ? new TrashError('conflict')
    : new TrashError('unavailable');

export function createTrashSource(repo: Repository, keyring: Keyring): TrashSource {
  return {
    async list() {
      let records;
      try {
        records = (await repo.memories.list({ includeTrashed: true })).filter(
          (r) => r.deletedAt !== null,
        );
      } catch (error) {
        throw wrap(error);
      }
      const items = await Promise.all(
        records.map(async (r): Promise<TrashItem> => {
          const deletedAt = r.deletedAt ?? 0;
          let title: string | null = null;
          let date: string | null = null;
          try {
            const p = parseMemoryPayload(
              await keyring.openMemory(r.id, r.schemaVersion, r.payload),
            );
            title = p.title;
            date = p.date;
          } catch {
            // ilegible: se lista sin título
          }
          return {
            id: r.id,
            title,
            date,
            deletedAt,
            purgeAt: deletedAt + TRASH_DAYS * 86_400,
            revision: r.revision,
          };
        }),
      );
      return items.sort((a, b) => b.deletedAt - a.deletedAt || a.id.localeCompare(b.id));
    },
    async restore(item) {
      try {
        await repo.memories.restore(item.id, item.revision);
      } catch (error) {
        throw wrap(error);
      }
    },
    async purge(item) {
      try {
        await repo.memories.purge(item.id);
      } catch (error) {
        if (error instanceof StorageError && error.code === 'not_found') return;
        throw wrap(error);
      }
    },
  };
}
