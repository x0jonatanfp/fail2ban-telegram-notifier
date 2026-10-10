// Adaptador `CounterStorePort` OPCIONAL para PostgreSQL.
//
// La instalación por defecto NO depende de `pg`: el módulo se importa de forma
// dinámica y solo cuando `COUNTER_BACKEND=postgres`. Si falta el paquete, se
// lanza un error claro que indica cómo instalarlo.
//
// Se reutiliza la tabla heredada `f2b_stats` con sus columnas originales
// (`count`, `last`, `total_bans`, `weekly`, helpers.py:91,123,152) para no
// romper los datos de producción existentes; el mapeo a la entidad de dominio
// (`daily`/`permanent`/`total`) se hace aquí:
//   count → daily, weekly → permanent, total_bans → total.
import type { CounterState } from "../../domain/entities/counter-state.ts";
import { emptyCounterState } from "../../domain/entities/counter-state.ts";
import type { CounterStorePort } from "../../domain/ports/counter-store.ts";
import type { LoggerPort } from "../../domain/ports/logger.ts";
import type { DatabaseConfig } from "../config/env.ts";

// Tipos mínimos de `pg` para no necesitar @types/pg (dependencia opcional).
interface PgQueryResult {
  rows: Array<Record<string, unknown>>;
}
interface PgClient {
  query(sql: string, params?: unknown[]): Promise<PgQueryResult>;
  release(): void;
}
interface PgPool {
  query(sql: string, params?: unknown[]): Promise<PgQueryResult>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}
interface PgModule {
  Pool: new (config: Record<string, unknown>) => PgPool;
}

export type ModuleLoader = (specifier: string) => Promise<unknown>;

/** Nombre del paquete en una variable para que el bundler no intente resolverlo. */
const PG_SPECIFIER = "pg";

export const CREATE_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS f2b_stats (" +
  "id SERIAL PRIMARY KEY, " +
  "count INTEGER NOT NULL DEFAULT 0, " +
  "last TIME WITHOUT TIME ZONE, " +
  "total_bans INTEGER NOT NULL DEFAULT 0, " +
  "weekly INTEGER NOT NULL DEFAULT 0)";

/** Mapea una fila de `f2b_stats` a la entidad de dominio. */
export function rowToCounterState(row: Record<string, unknown> | undefined): CounterState {
  if (row === undefined) return emptyCounterState();
  const toNumber = (value: unknown): number => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") return Number(value);
    return 0;
  };
  return {
    daily: toNumber(row.count),
    permanent: toNumber(row.weekly),
    total: toNumber(row.total_bans),
    last: row.last === null || row.last === undefined ? null : String(row.last),
  };
}

export class PostgresCounterStore implements CounterStorePort {
  private pool: PgPool | undefined;

  constructor(
    private readonly database: DatabaseConfig,
    private readonly logger: LoggerPort,
    private readonly loadModule: ModuleLoader = (specifier) => import(specifier),
  ) {}

  private async getPool(): Promise<PgPool> {
    if (this.pool !== undefined) return this.pool;

    let mod: unknown;
    try {
      mod = await this.loadModule(PG_SPECIFIER);
    } catch {
      throw new Error(
        "COUNTER_BACKEND=postgres requiere el paquete opcional 'pg'. " +
          "Instálalo con: pnpm add pg",
      );
    }
    const pg = (mod as { default?: PgModule }).default ?? (mod as PgModule);
    const pool = new pg.Pool({
      host: this.database.host,
      port: this.database.port,
      database: this.database.database,
      user: this.database.user,
      password: this.database.password,
      max: 5,
      connectionTimeoutMillis: 5000,
    });
    await pool.query(CREATE_SCHEMA_SQL);
    this.pool = pool;
    this.logger.info("Pool de PostgreSQL creado.", {
      host: this.database.host,
      port: this.database.port,
      database: this.database.database,
    });
    return pool;
  }

  async load(): Promise<CounterState> {
    const pool = await this.getPool();
    const result = await pool.query(
      "SELECT count, last, total_bans, weekly FROM f2b_stats ORDER BY id DESC LIMIT 1",
    );
    return rowToCounterState(result.rows[0]);
  }

  async save(state: CounterState): Promise<void> {
    const pool = await this.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT id FROM f2b_stats ORDER BY id DESC LIMIT 1 FOR UPDATE",
      );
      const row = existing.rows[0];
      if (row !== undefined) {
        await client.query(
          "UPDATE f2b_stats SET count=$1, last=$2::time, total_bans=$3, weekly=$4 WHERE id=$5",
          [state.daily, state.last, state.total, state.permanent, row.id],
        );
      } else {
        await client.query(
          "INSERT INTO f2b_stats (count, last, total_bans, weekly) VALUES ($1, $2::time, $3, $4)",
          [state.daily, state.last, state.total, state.permanent],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Cierra el pool; lo usa el composition root al parar. */
  async close(): Promise<void> {
    if (this.pool !== undefined) {
      await this.pool.end().catch(() => undefined);
      this.pool = undefined;
    }
  }
}
