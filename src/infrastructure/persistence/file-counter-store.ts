// Adaptador `CounterStorePort`: persiste el contador en un fichero JSON.
//
// Es el backend POR DEFECTO para que "instalar desde fuente" no requiera base
// de datos. La escritura es atómica (fichero temporal + rename) y se serializa
// con una cola interna para que dos `save` concurrentes no se pisen.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { CounterState } from "../../domain/entities/counter-state.ts";
import { emptyCounterState } from "../../domain/entities/counter-state.ts";
import type { CounterStorePort } from "../../domain/ports/counter-store.ts";
import type { LoggerPort } from "../../domain/ports/logger.ts";

function isNotFound(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === "ENOENT";
}

/** Normaliza un valor leído del JSON, tolerando datos parciales o corruptos. */
export function normalizeCounterState(value: unknown): CounterState {
  if (value === null || typeof value !== "object") return emptyCounterState();
  const record = value as Record<string, unknown>;
  const toNumber = (input: unknown): number =>
    typeof input === "number" && Number.isFinite(input) ? input : 0;
  return {
    daily: toNumber(record.daily),
    permanent: toNumber(record.permanent),
    total: toNumber(record.total),
    last: typeof record.last === "string" ? record.last : null,
  };
}

export class FileCounterStore implements CounterStorePort {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly logger: LoggerPort,
  ) {}

  async load(): Promise<CounterState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeCounterState(JSON.parse(raw));
    } catch (error) {
      if (isNotFound(error)) return emptyCounterState();
      this.logger.warn("Contador ilegible; se parte de cero.", {
        file: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return emptyCounterState();
    }
  }

  async save(state: CounterState): Promise<void> {
    // Serializa las escrituras encadenándolas.
    this.writeChain = this.writeChain.then(() => this.writeAtomic(state));
    return this.writeChain;
  }

  private async writeAtomic(state: CounterState): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const tempPath = `${this.filePath}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}
