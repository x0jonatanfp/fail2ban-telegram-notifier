import { afterEach, describe, expect, it } from "vitest";
import { appendFile, chmod, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TailLogSource } from "../../src/infrastructure/fail2ban/tail-log-source.ts";
import type { LogEvent } from "../../src/domain/ports/event-source.ts";
import {
  createTestLogger,
  makeTempDir,
  removeDir,
  waitFor,
} from "../test/helpers.ts";

const dirs: string[] = [];
const sources: TailLogSource[] = [];
afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.stop()));
  await Promise.all(dirs.splice(0).map((dir) => removeDir(dir)));
});

// Acelera los sondeos y los reintentos para no esperar segundos reales.
const fastSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));

async function setup(initial: string): Promise<{ dir: string; file: string }> {
  const dir = await makeTempDir();
  dirs.push(dir);
  const file = join(dir, "fail2ban.log");
  await writeFile(file, initial, "utf8");
  return { dir, file };
}

function sourceFor(file: string) {
  const source = new TailLogSource({
    filePath: file,
    pollIntervalMs: 10,
    logger: createTestLogger(),
    sleep: fastSleep,
  });
  sources.push(source);
  return source;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TailLogSource", () => {
  it("emite las líneas nuevas (sin leer el histórico)", async () => {
    const { file } = await setup("vieja linea\n");
    const events: LogEvent[] = [];
    const source = sourceFor(file);
    await source.start(async (event) => {
      events.push(event);
    });
    await sleep(30); // deja que abra y se sitúe al final

    await appendFile(file, "linea nueva 1\nlinea nueva 2\n", "utf8");
    await waitFor(() => events.filter((e) => e.kind === "line").length >= 2);

    const lines = events.filter((e) => e.kind === "line").map((e) => e.raw);
    expect(lines).toEqual(["linea nueva 1", "linea nueva 2"]);
  });

  it("detecta rotación por tamaño (truncado)", async () => {
    const { file } = await setup("012345678901234567890123456789\n");
    const events: LogEvent[] = [];
    const source = sourceFor(file);
    await source.start(async (event) => {
      events.push(event);
    });
    await sleep(30);
    await appendFile(file, "linea leida\n", "utf8");
    await waitFor(() => events.some((e) => e.kind === "line"));

    await writeFile(file, "", "utf8"); // trunca → el fichero "encoge"
    await waitFor(() => events.some((e) => e.kind === "rotation"));
    const rotation = events.find((e) => e.kind === "rotation");
    expect(rotation).toEqual({ kind: "rotation", reason: "size" });
  });

  it("detecta reemplazo por inode", async () => {
    const { dir, file } = await setup("corta\n");
    const events: LogEvent[] = [];
    const source = sourceFor(file);
    await source.start(async (event) => {
      events.push(event);
    });
    await sleep(30);
    await appendFile(file, "otra\n", "utf8");
    await waitFor(() => events.some((e) => e.kind === "line"));

    // Reemplazo atómico por rename: nuevo inode y tamaño >= offset para que no
    // dispare primero la rama de tamaño (igual que el original, que comprueba
    // tamaño antes que inode).
    const newFile = join(dir, "fail2ban.log.new");
    await writeFile(newFile, "contenido suficientemente largo para superar el offset\n", "utf8");
    await rename(newFile, file);

    await waitFor(() => events.some((e) => e.kind === "rotation"));
    const rotation = events.find((e) => e.kind === "rotation");
    expect(rotation).toEqual({ kind: "rotation", reason: "inode" });
  });

  it("se recupera si el fichero no existe al arrancar", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const file = join(dir, "todavia-no.log");
    const logger = createTestLogger();
    const source = new TailLogSource({
      filePath: file,
      pollIntervalMs: 10,
      logger,
      sleep: fastSleep,
    });
    sources.push(source);

    const lines: string[] = [];
    await source.start(async (event) => {
      if (event.kind === "line") lines.push(event.raw);
    });
    await waitFor(() => logger.messagesOf("error").some((m) => m.includes("no encontrado")));

    await writeFile(file, "", "utf8");
    await sleep(30);
    await appendFile(file, "ya existe\n", "utf8");
    await waitFor(() => lines.length >= 1);
    expect(lines).toEqual(["ya existe"]);
  });

  it("registra un error genérico (ELOOP) y reintenta", async () => {
    const { file } = await setup("inicial\n");
    const logger = createTestLogger();
    const source = new TailLogSource({
      filePath: file,
      pollIntervalMs: 10,
      logger,
      sleep: fastSleep,
    });
    sources.push(source);
    await source.start(async () => {});
    await sleep(30);

    // Sustituye el fichero por un symlink que se apunta a sí mismo → ELOOP,
    // que no es ENOENT ni EACCES, así que cae en la rama de error genérico.
    await rm(file);
    await symlink(file, file);

    await waitFor(() =>
      logger.messagesOf("error").some((m) => m.includes("Error leyendo logs")),
    );
  });

  it("registra error y reintenta si no hay permiso de lectura (EACCES)", async () => {
    const { file } = await setup("contenido\n");
    const logger = createTestLogger();
    const source = new TailLogSource({
      filePath: file,
      pollIntervalMs: 10,
      logger,
      sleep: fastSleep,
    });
    sources.push(source);

    await chmod(file, 0o000); // sin permisos: open() → EACCES
    await source.start(async () => {});
    await waitFor(() =>
      logger.messagesOf("error").some((m) => m.includes("Sin permiso")),
    );
    await chmod(file, 0o600); // restaura para que el cleanup no falle
  });

  it("sin sleep inyectado usa el temporizador real y despierta al parar", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const file = join(dir, "no-existe.log");
    const logger = createTestLogger();
    const source = new TailLogSource({ filePath: file, pollIntervalMs: 10, logger });
    sources.push(source);

    await source.start(async () => {});
    await waitFor(() =>
      logger.messagesOf("error").some((m) => m.includes("no encontrado")),
    );
    // Está durmiendo 10 s reales; dejamos que entre en el sleep y comprobamos
    // que stop() lo despierta de inmediato (no espera los 10 s).
    await sleep(20);
    await source.stop();
  });
});
