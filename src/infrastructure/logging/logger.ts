// Adaptador de logging SIN dependencias externas.
//
// Escribe a stdout (debug/info) y stderr (warn/error), que systemd/journald
// captura, y opcionalmente hace append a `LOG_FILE` si está definido. Se evita
// mantener un fd abierto: cada línea abre/cierra en modo append, de modo que
// `logrotate` externo pueda rotar el fichero sin coordinación.
import { appendFileSync } from "node:fs";
import type { LogLevel, LogMeta, LoggerPort } from "../../domain/ports/logger.ts";

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  level: LogLevel;
  /** Si se define, además de stdout/stderr se anexa a este fichero. */
  file?: string;
}

function formatMeta(meta?: LogMeta): string {
  if (meta === undefined || Object.keys(meta).length === 0) return "";
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [meta no serializable]";
  }
}

function formatLine(level: LogLevel, message: string, meta?: LogMeta): string {
  const timestamp = new Date().toISOString();
  return `${timestamp} ${level.toUpperCase().padEnd(5)} ${message}${formatMeta(meta)}`;
}

export function createLogger(options: LoggerOptions): LoggerPort {
  const threshold = LEVEL_VALUE[options.level];
  const file = options.file;

  const write = (level: LogLevel, message: string, meta?: LogMeta): void => {
    if (LEVEL_VALUE[level] < threshold) return;
    const line = formatLine(level, message, meta);
    if (level === "warn" || level === "error") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
    if (file !== undefined) {
      try {
        appendFileSync(file, `${line}\n`);
      } catch {
        // No tumbar el bot porque el log no se pueda escribir: solo avisar por
        // stderr una vez por línea fallida (evitamos recursión infinita).
        process.stderr.write(
          `${new Date().toISOString()} ERROR No se pudo escribir en LOG_FILE=${file}\n`,
        );
      }
    }
  };

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
  };
}
