import { describe, expect, it } from "vitest";
import {
  PostgresCounterStore,
  rowToCounterState,
} from "../../src/infrastructure/persistence/postgres-counter-store.ts";
import { createTestLogger } from "../test/helpers.ts";

const DB = { host: "h", port: 5432, database: "d", user: "u", password: "p" };

interface QueryLog {
  sql: string;
  params?: unknown[];
}

function fakePg(config: {
  countRows?: Array<Record<string, unknown>>;
  idRows?: Array<Record<string, unknown>>;
}): { module: unknown; queries: QueryLog[] } {
  const queries: QueryLog[] = [];
  const query = async (sql: string, params?: unknown[]) => {
    queries.push(params !== undefined ? { sql, params } : { sql });
    if (sql.startsWith("SELECT count")) return { rows: config.countRows ?? [] };
    if (sql.startsWith("SELECT id")) return { rows: config.idRows ?? [] };
    return { rows: [] };
  };
  const pool = {
    query,
    connect: async () => ({ query, release: () => undefined }),
    end: async () => undefined,
  };
  const Pool = function () {
    return pool;
  };
  return { module: { Pool }, queries };
}

describe("rowToCounterState", () => {
  it("mapea las columnas heredadas a la entidad de dominio", () => {
    expect(
      rowToCounterState({ count: 3, last: "12:00:00", total_bans: 10, weekly: 1 }),
    ).toEqual({ daily: 3, permanent: 1, total: 10, last: "12:00:00" });
  });

  it("sin fila devuelve estado inicial", () => {
    expect(rowToCounterState(undefined)).toEqual({
      daily: 0,
      permanent: 0,
      total: 0,
      last: null,
    });
  });
});

describe("PostgresCounterStore", () => {
  it("crea el esquema y carga la última fila", async () => {
    const fake = fakePg({ countRows: [{ count: 5, last: "10:00:00", total_bans: 20, weekly: 2 }] });
    const store = new PostgresCounterStore(DB, createTestLogger(), async () => fake.module);

    const state = await store.load();

    expect(state).toEqual({ daily: 5, permanent: 2, total: 20, last: "10:00:00" });
    expect(fake.queries[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS f2b_stats");
    expect(fake.queries.some((q) => q.sql.startsWith("SELECT count"))).toBe(true);
  });

  it("hace UPDATE si ya existe una fila", async () => {
    const fake = fakePg({ idRows: [{ id: 7 }] });
    const store = new PostgresCounterStore(DB, createTestLogger(), async () => fake.module);

    await store.save({ daily: 4, permanent: 2, total: 11, last: "13:00:00" });

    const update = fake.queries.find((q) => q.sql.startsWith("UPDATE"));
    expect(update?.params).toEqual([4, "13:00:00", 11, 2, 7]);
  });

  it("hace INSERT si la tabla está vacía", async () => {
    const fake = fakePg({ idRows: [] });
    const store = new PostgresCounterStore(DB, createTestLogger(), async () => fake.module);

    await store.save({ daily: 4, permanent: 2, total: 11, last: "13:00:00" });

    const insert = fake.queries.find((q) => q.sql.startsWith("INSERT"));
    expect(insert?.params).toEqual([4, "13:00:00", 11, 2]);
  });

  it("si falta el paquete pg, error claro con instrucciones", async () => {
    const store = new PostgresCounterStore(DB, createTestLogger(), async () => {
      throw new Error("module not found");
    });
    await expect(store.load()).rejects.toThrowError(/pnpm add pg/);
  });
});
