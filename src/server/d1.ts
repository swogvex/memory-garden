/**
 * Subconjunto de la API de D1 que usa el servidor. `D1Database` lo cumple de forma estructural;
 * en las pruebas lo cumple un adaptador sobre SQLite real (tests/unit/server/_d1.ts).
 * Todas las sentencias son literales con parámetros enlazados (PS-01): nunca se concatena entrada.
 */
export interface D1RunMeta {
  changes?: number;
  last_row_id?: number;
}

export interface D1ResultLike<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: D1RunMeta;
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1ResultLike<T>>;
  run(): Promise<D1ResultLike>;
}

export interface D1Like {
  prepare(query: string): D1StatementLike;
  /** Transacción: si una sentencia falla, ninguna se aplica. */
  batch(statements: D1StatementLike[]): Promise<D1ResultLike[]>;
}
