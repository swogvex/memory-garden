/**
 * Subconjunto de R2 que usa el servidor. `R2Bucket` lo cumple de forma estructural; en las pruebas lo cumple
 * un almacén en memoria (tests/unit/server/_r2.ts). El bucket no tiene acceso público: solo se llega por el Worker.
 */
export interface R2BodyLike {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
}

export interface R2Like {
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2BodyLike | null>;
  /** Borrar una clave que no existe no es un error. */
  delete(keys: string | string[]): Promise<void>;
}
