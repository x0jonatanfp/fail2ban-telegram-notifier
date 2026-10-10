import { describe, expect, it, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FileCounterStore,
  normalizeCounterState,
} from "../../src/infrastructure/persistence/file-counter-store.ts";
import { createTestLogger, makeTempDir, removeDir } from "../test/helpers.ts";

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await makeTempDir();
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => removeDir(dir)));
});

describe("FileCounterStore", () => {
  it("load sin fichero devuelve estado inicial", async () => {
    const dir = await tempDir();
    const store = new FileCounterStore(join(dir, "nested", "counter.json"), createTestLogger());
    expect(await store.load()).toEqual({
      daily: 0,
      permanent: 0,
      total: 0,
      last: null,
    });
  });

  it("save y load hacen round-trip (crea el directorio)", async () => {
    const dir = await tempDir();
    const file = join(dir, "nested", "counter.json");
    const store = new FileCounterStore(file, createTestLogger());
    await store.save({ daily: 3, permanent: 1, total: 10, last: "12:00:00" });
    expect(await store.load()).toEqual({
      daily: 3,
      permanent: 1,
      total: 10,
      last: "12:00:00",
    });
  });

  it("un fichero corrupto no tumba el bot: parte de cero y avisa", async () => {
    const dir = await tempDir();
    const file = join(dir, "counter.json");
    await writeFile(file, "{ esto no es json", "utf8");
    const logger = createTestLogger();
    const store = new FileCounterStore(file, logger);
    expect(await store.load()).toEqual({
      daily: 0,
      permanent: 0,
      total: 0,
      last: null,
    });
    expect(logger.messagesOf("warn")).toContain("Contador ilegible; se parte de cero.");
  });

  it("serializa escrituras concurrentes sin corromper el JSON", async () => {
    const dir = await tempDir();
    const file = join(dir, "counter.json");
    const store = new FileCounterStore(file, createTestLogger());
    await Promise.all([
      store.save({ daily: 1, permanent: 0, total: 0, last: "a" }),
      store.save({ daily: 2, permanent: 0, total: 0, last: "b" }),
      store.save({ daily: 3, permanent: 0, total: 0, last: "c" }),
    ]);
    const raw = await readFile(file, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(await store.load()).toEqual({
      daily: 3,
      permanent: 0,
      total: 0,
      last: "c",
    });
  });
});

describe("normalizeCounterState", () => {
  it("tolera basura y campos parciales", () => {
    expect(normalizeCounterState(null)).toEqual({
      daily: 0,
      permanent: 0,
      total: 0,
      last: null,
    });
    expect(normalizeCounterState({ daily: 2, last: 5 })).toEqual({
      daily: 2,
      permanent: 0,
      total: 0,
      last: null,
    });
  });
});
