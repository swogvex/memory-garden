/**
 * Renombrar o eliminar una categoría cambia el texto de la categoría DENTRO de cada recuerdo cifrado: el servidor no
 * sabe qué categoría tiene cada uno, así que el cambio se hace aquí, recuerdo a recuerdo (decisión del usuario).
 *
 * Orden seguro: primero se reescriben los recuerdos y, solo si TODOS se guardan, la lista de categorías.
 * Si la conexión cae a mitad, unos recuerdos tienen ya el nombre nuevo y otros el viejo; repetir la operación termina los
 * que faltan (solo se tocan los que aún tienen el nombre viejo). Mientras tanto, el formulario muestra cualquier
 * categoría desconocida de un recuerdo como una opción más, así que nada se pierde ni se rompe.
 *
 * Cada recuerdo conserva su flor, sus fotos y todo lo demás. Los recuerdos de la papelera no se tocan.
 */
import type { GardenMemory, GardenSource, MemoryFields, PhotoSlot } from '@/features/calendar';

function fieldsOf(memory: GardenMemory): MemoryFields {
  return {
    title: memory.title,
    date: memory.date,
    category: memory.category,
    text: memory.text,
    link: memory.link,
    flower: memory.flower,
    season: memory.season,
  };
}

function keptSlots(memory: GardenMemory): PhotoSlot[] {
  return memory.photos.map((p) => ({
    kind: 'kept' as const,
    assetId: p.assetId,
    thumbId: p.thumbId,
    alt: p.alt,
  }));
}

export interface MoveProgress {
  readonly done: number;
  readonly total: number;
}

/** Falló a mitad: `done` recuerdos ya llevan la categoría nueva. */
export class MoveError extends Error {
  readonly done: number;
  readonly total: number;
  constructor(done: number, total: number) {
    super('settings:move_failed');
    this.name = 'MoveError';
    this.done = done;
    this.total = total;
  }
}

export async function countInCategory(garden: GardenSource, name: string): Promise<number> {
  return (await garden.list()).filter((m) => m.category === name).length;
}

/** Pasa a `to` todos los recuerdos (no borrados) de la categoría `from`. Devuelve cuántos se cambiaron. */
export async function moveCategory(
  garden: GardenSource,
  from: string,
  to: string,
  onProgress?: (progress: MoveProgress) => void,
): Promise<number> {
  if (from === to) return 0;
  const affected = (await garden.list()).filter((m) => m.category === from);
  const total = affected.length;
  let done = 0;
  onProgress?.({ done, total });
  for (const memory of affected) {
    try {
      await garden.update(memory.id, {
        fields: { ...fieldsOf(memory), category: to },
        photos: keptSlots(memory),
      });
    } catch {
      throw new MoveError(done, total);
    }
    done++;
    onProgress?.({ done, total });
  }
  return total;
}
