import type { R2BodyLike, R2Like } from '@/server/r2';

/** R2 en memoria para las pruebas, con inyección de fallos. Cumple `R2Like` igual que el `R2Bucket` real. */
export interface FakeR2 extends R2Like {
  store: Map<string, Uint8Array>;
  puts: string[];
  deletes: string[];
  failPut: boolean;
  failGet: boolean;
}

export function createR2(): FakeR2 {
  const store = new Map<string, Uint8Array>();
  const fake: FakeR2 = {
    store,
    puts: [],
    deletes: [],
    failPut: false,
    failGet: false,
    async put(key, value) {
      if (fake.failPut) throw new Error('R2 caído');
      fake.puts.push(key);
      store.set(key, new Uint8Array(value));
    },
    async get(key): Promise<R2BodyLike | null> {
      if (fake.failGet) throw new Error('R2 caído');
      const bytes = store.get(key);
      if (!bytes) return null;
      return {
        size: bytes.length,
        body: new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array>,
      };
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        fake.deletes.push(k);
        store.delete(k);
      }
    },
  };
  return fake;
}
