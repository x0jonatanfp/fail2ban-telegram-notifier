import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "../../src/infrastructure/logging/logger.ts";
import { makeTempDir, removeDir } from "../test/helpers.ts";

// Nunca escupimos logs reales a la consola del test runner: interceptamos
// process.stdout/stderr y recogemos lo escrito.
function spyStreams() {
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return {
    outSpy,
    errSpy,
    out: (): string[] => outSpy.mock.calls.map((call) => String(call[0])).join("").split("\n").filter(Boolean),
    err: (): string[] => errSpy.mock.calls.map((call) => String(call[0])).join("").split("\n").filter(Boolean),
  };
}

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await makeTempDir();
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => removeDir(dir)));
});

describe("createLogger", () => {
  it("enruta debug/info a stdout y warn/error a stderr", () => {
    const streams = spyStreams();
    const logger = createLogger({ level: "debug" });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    // Comprobamos nivel a nivel para no depender del orden entre streams.
    expect(streams.out().some((l) => l.includes(" DEBUG d"))).toBe(true);
    expect(streams.out().some((l) => l.includes(" INFO  i"))).toBe(true);
    expect(streams.out().some((l) => l.includes(" WARN"))).toBe(false);
    expect(streams.err().some((l) => l.includes(" WARN  w"))).toBe(true);
    expect(streams.err().some((l) => l.includes(" ERROR e"))).toBe(true);
    expect(streams.err().some((l) => l.includes(" INFO"))).toBe(false);
  });

  it("filtra por nivel: por debajo del umbral no escribe nada", () => {
    const streams = spyStreams();
    const logger = createLogger({ level: "warn" });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(streams.out()).toEqual([]);
    expect(streams.err()).toHaveLength(2);
    expect(streams.err()[0]).toContain("WARN");
    expect(streams.err()[1]).toContain("ERROR");
  });

  it("da formato ISO + nivel + mensaje + meta JSON", () => {
    const streams = spyStreams();
    const logger = createLogger({ level: "debug" });

    logger.info("Arrancando", { transport: "gateway", port: 14120 });

    const line = streams.out()[0] ?? "";
    expect(line).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO {2}Arrancando \{"transport":"gateway","port":14120\}$/,
    );
  });

  it("sin meta (o meta vacío) no añade sufijo", () => {
    const streams = spyStreams();
    const logger = createLogger({ level: "debug" });

    logger.info("sin meta");
    logger.info("meta vacía", {});

    expect(streams.out()[0]).toMatch(/ INFO {2}sin meta$/);
    expect(streams.out()[1]).toMatch(/ INFO {2}meta vacía$/);
  });

  it("un meta no serializable no revienta: lo marca", () => {
    const streams = spyStreams();
    const logger = createLogger({ level: "debug" });

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logger.info("circular", circular);

    expect(streams.out()[0]).toContain("[meta no serializable]");
  });

  it("si LOG_FILE está definido, anexa cada línea al fichero", async () => {
    const streams = spyStreams();
    const dir = await tempDir();
    const file = join(dir, "app.log");
    const logger = createLogger({ level: "info", file });

    logger.info("primera", { a: 1 });
    logger.warn("segunda");

    const content = await readFile(file, "utf8");
    const lines = content.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(" INFO  primera {\"a\":1}");
    expect(lines[1]).toContain(" WARN  segunda");
    // Y también salió por consola además del fichero.
    expect(streams.out().some((l) => l.includes("primera"))).toBe(true);
  });

  it("si no se puede escribir en LOG_FILE, no lanza y avisa por stderr", async () => {
    const streams = spyStreams();
    const dir = await tempDir();
    // El directorio padre no existe ⇒ appendFileSync falla (ENOENT).
    const file = join(dir, "no-existe-la-carpeta", "app.log");
    const logger = createLogger({ level: "info", file });

    expect(() => logger.info("mensaje")).not.toThrow();

    expect(streams.out().some((l) => l.includes("mensaje"))).toBe(true);
    expect(
      streams.err().some((l) =>
        l.includes(`No se pudo escribir en LOG_FILE=${file}`),
      ),
    ).toBe(true);
  });
});
