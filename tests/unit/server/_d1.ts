import { readFileSync } from 'node:fs';
import type { D1Like, D1ResultLike, D1StatementLike } from '@/server/d1';

/**
 * Adaptador de D1 sobre SQLite real (`node:sqlite`) SOLO para pruebas. Cumple el subconjunto de `D1Like`:
 * `batch` es una transacción (si una sentencia falla, ninguna se aplica) y las claves foráneas están activas,
 * como en D1. No es D1 (workerd): la aplicación de la migración en D1 local la comprueba el usuario con wrangler (PS-46).
 * `node:sqlite` se obtiene con `process.getBuiltinModule` para no depender de cómo Vite resuelva módulos «solo con prefijo».
 */
interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}
export interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as unknown as {
  DatabaseSync: new (path: string) => SqliteDb;
};

const MIGRATIONS = ['0001_init.sql', '0002_setup_lock.sql'];

export function migrationSql(file: string): string {
  return readFileSync(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8');
}

class Statement implements D1StatementLike {
  constructor(
    private readonly raw: SqliteDb,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1StatementLike {
    return new Statement(this.raw, this.sql, values);
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.raw.prepare(this.sql).get(...this.params);
    return row ? ({ ...(row as object) } as T) : null;
  }

  async all<T = unknown>(): Promise<D1ResultLike<T>> {
    return this.executeSync() as D1ResultLike<T>;
  }

  async run(): Promise<D1ResultLike> {
    return this.executeSync();
  }

  executeSync(): D1ResultLike {
    const stmt = this.raw.prepare(this.sql);
    if (/^\s*select\b/i.test(this.sql) || /\breturning\b/i.test(this.sql)) {
      const results = stmt.all(...this.params).map((r) => ({ ...(r as object) }));
      return { results, success: true, meta: {} };
    }
    const r = stmt.run(...this.params);
    return {
      results: [],
      success: true,
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
    };
  }
}

export interface TestD1 {
  db: D1Like;
  raw: SqliteDb;
  /** Número de sentencias ejecutadas desde la última puesta a cero (para vigilar escrituras). */
  close(): void;
}

export function createD1(migrate = true): TestD1 {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  if (migrate) for (const file of MIGRATIONS) raw.exec(migrationSql(file));
  const db: D1Like = {
    prepare: (query) => new Statement(raw, query),
    async batch(statements) {
      raw.exec('BEGIN');
      try {
        const out = statements.map((s) => (s as Statement).executeSync());
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return { db, raw, close: () => raw.close() };
}

/** Atajo para consultas de comprobación en las pruebas. */
export function rows<T = Record<string, unknown>>(
  raw: SqliteDb,
  sql: string,
  ...params: unknown[]
): T[] {
  return raw.prepare(sql).all(...params) as T[];
}
