// Adaptador del puerto `EventSourcePort`: hace tail de `fail2ban.log`.
//
// Réplica de `read_log` (f2b.py:27-98):
//   - al abrir, se sitúa al FINAL del fichero (seek(0,2) → decisión 9), para no
//     renotificar el histórico al reiniciar.
//   - detecta rotación por TAMAÑO (el fichero encogió) y por INODE (reemplazo),
//     en ese orden, y avisa al consumidor (`rotation` con motivo `size`/`inode`).
//   - ante FileNotFoundError espera 10 s; ante PermissionError u otro error,
//     60 s; luego reabre.
//
// Diferencia deliberada: se bufferiza una línea incompleta (sin `\n`) hasta que
// llega el salto, en vez de emitirla a medias como hace `readline` en EOF; esto
// es más correcto y no altera el caso normal (fail2ban escribe líneas enteras).
import { open, stat, type FileHandle } from "node:fs/promises";
import type {
  EventSourcePort,
  LogEventHandler,
} from "../../domain/ports/event-source.ts";
import type { LoggerPort } from "../../domain/ports/logger.ts";

/** No leer de golpe más de 1 MiB por iteración (ficheros de log grandes). */
const MAX_READ_BYTES = 1024 * 1024;

const NOT_FOUND_RETRY_MS = 10000;
const PERMISSION_RETRY_MS = 60000;
const ERROR_RETRY_MS = 60000;

export interface TailLogSourceOptions {
  filePath: string;
  pollIntervalMs: number;
  logger: LoggerPort;
  /** `sleep` inyectable para tests (evita esperas reales). */
  sleep?: (ms: number) => Promise<void>;
}

interface OpenedFile {
  handle: FileHandle;
  inode: number;
  size: number;
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | undefined)?.code;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readRange(
  handle: FileHandle,
  start: number,
  length: number,
): Promise<{ text: string; bytes: number }> {
  const buffer = Buffer.alloc(length);
  let total = 0;
  while (total < length) {
    const { bytesRead } = await handle.read(
      buffer,
      total,
      length - total,
      start + total,
    );
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return { text: buffer.subarray(0, total).toString("utf8"), bytes: total };
}

export class TailLogSource implements EventSourcePort {
  private running = false;
  private loopPromise: Promise<void> | undefined;
  private wakeSleep: (() => void) | undefined;

  constructor(private readonly options: TailLogSourceOptions) {}

  async start(onEvent: LogEventHandler): Promise<void> {
    this.running = true;
    this.loopPromise = this.loop(onEvent);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wakeSleep?.();
    try {
      await this.loopPromise;
    } catch {
      // El bucle ya registra sus errores; no propagamos en la parada.
    }
    this.loopPromise = undefined;
  }

  private sleep(ms: number): Promise<void> {
    if (this.options.sleep !== undefined) return this.options.sleep(ms);
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wakeSleep = undefined;
        resolve();
      }, ms);
      // Permite despertar antes de tiempo desde stop().
      this.wakeSleep = () => {
        clearTimeout(timer);
        this.wakeSleep = undefined;
        resolve();
      };
    });
  }

  private async openAtEnd(): Promise<OpenedFile> {
    const handle = await open(this.options.filePath, "r");
    const info = await handle.stat();
    return { handle, inode: Number(info.ino), size: info.size };
  }

  private async retryAfterError(error: unknown): Promise<void> {
    const code = errorCode(error);
    if (code === "ENOENT") {
      this.options.logger.error(
        `Archivo ${this.options.filePath} no encontrado. Reintentando...`,
      );
      await this.sleep(NOT_FOUND_RETRY_MS);
      return;
    }
    if (code === "EACCES" || code === "EPERM") {
      this.options.logger.error(`Sin permiso para leer ${this.options.filePath}.`);
      await this.sleep(PERMISSION_RETRY_MS);
      return;
    }
    this.options.logger.error("Error leyendo logs.", { error: errorText(error) });
    await this.sleep(ERROR_RETRY_MS);
  }

  private async loop(onEvent: LogEventHandler): Promise<void> {
    while (this.running) {
      const opened = await this.openAtEnd().catch(async (error: unknown) => {
        await this.retryAfterError(error);
        return undefined;
      });
      if (opened === undefined) continue;

      const { handle } = opened;
      const inode = opened.inode;
      let offset = opened.size;
      let pending = "";

      try {
        while (this.running) {
          const info = await stat(this.options.filePath);

          // 1) Rotación por tamaño (el fichero encogió).
          if (info.size < offset) {
            this.options.logger.info("Rotación de log detectada, reabriendo archivo.");
            await onEvent({ kind: "rotation", reason: "size" });
            break;
          }

          // 2) Reemplazo por inode (logrotate con create).
          if (Number(info.ino) !== inode) {
            this.options.logger.info("Reemplazo de archivo de log detectado, reabriendo.");
            await onEvent({ kind: "rotation", reason: "inode" });
            break;
          }

          // 3) Hay datos nuevos: leer hasta el final y emitir líneas completas.
          if (info.size > offset) {
            const length = Math.min(info.size - offset, MAX_READ_BYTES);
            const { text, bytes } = await readRange(handle, offset, length);
            offset += bytes;
            pending += text;
            const parts = pending.split("\n");
            pending = parts.pop() ?? "";
            for (const line of parts) {
              if (line.length > 0) await onEvent({ kind: "line", raw: line });
            }
            continue;
          }

          // 4) Sin novedades: dormir el intervalo de sondeo.
          await this.sleep(this.options.pollIntervalMs);
        }
      } catch (error) {
        await this.retryAfterError(error);
      } finally {
        await handle.close().catch(() => undefined);
      }
      // En rotación se reabre de inmediato (igual que el `break` del original);
      // en error, `retryAfterError` ya ha esperado.
    }
  }
}
