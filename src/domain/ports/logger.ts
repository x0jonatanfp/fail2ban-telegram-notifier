// Puerto de logging. Vive en `domain` como interfaz (sin implementación) para
// que `application` pueda registrar sin depender de `infrastructure`. El
// adaptador real (stdout/stderr + fichero opcional) está en `infrastructure`.
export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogMeta = Record<string, unknown>;

export interface LoggerPort {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}
