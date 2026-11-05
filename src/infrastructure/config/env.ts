// Adaptador de configuración: lee y VALIDA las variables de entorno.
//
// Fail-fast: si algo es inválido se lanza `ConfigError` con el detalle y el
// proceso no arranca (no queremos un bot a medias). Toda la configuración es
// externa; nada del servidor del autor queda hardcodeado.
import type { LogLevel } from "../../domain/ports/logger.ts";
import type { MessageLang } from "../../domain/services/message-format.ts";

export type Transport = "direct" | "gateway";
export type CounterBackend = "file" | "postgres";
export type NotifyMode = "instant" | "batch";
export type NotifyUnbans = "count" | "off" | "list";

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface AppConfig {
  transport: Transport;
  chatId: string;
  threadId?: number;
  parseMode: string;
  messageLang: MessageLang;
  /** Token del bot; obligatorio solo en `direct`. */
  botToken?: string;
  apiBaseUrl: string;
  pollTimeoutSec: number;
  gatewayUrl: string;
  webhookHost: string;
  webhookPort: number;
  gatewayReregisterMs: number;
  fail2banLogPath: string;
  permanentJails: string[];
  ignoreJails: string[];
  ignoreIps: string[];
  suppressShutdownFlush: boolean;
  pollIntervalMs: number;
  notifyMode: NotifyMode;
  batchWindowSec: number;
  batchShowIps: boolean;
  batchMaxEvents: number;
  instantJails: string[];
  notifyUnbans: NotifyUnbans;
  counterBackend: CounterBackend;
  counterFile: string;
  database: DatabaseConfig;
  logLevel: LogLevel;
  logFile?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/** Lee, valida y agrega los errores para dar un mensaje único y claro. */
class EnvReader {
  readonly errors: string[] = [];

  constructor(private readonly env: Env) {}

  private raw(key: string): string | undefined {
    const value = this.env[key];
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }

  str(key: string, fallback: string): string {
    return this.raw(key) ?? fallback;
  }

  optional(key: string): string | undefined {
    return this.raw(key);
  }

  required(key: string): string {
    const value = this.raw(key);
    if (value === undefined) {
      this.errors.push(`${key} es obligatorio y está vacío.`);
      return "";
    }
    return value;
  }

  int(
    key: string,
    fallback: number,
    bounds?: { min?: number; max?: number },
  ): number {
    const value = this.raw(key);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      this.errors.push(`${key} debe ser un número entero (recibido "${value}").`);
      return fallback;
    }
    if (bounds?.min !== undefined && parsed < bounds.min) {
      this.errors.push(`${key} debe ser >= ${bounds.min} (recibido ${parsed}).`);
      return fallback;
    }
    if (bounds?.max !== undefined && parsed > bounds.max) {
      this.errors.push(`${key} debe ser <= ${bounds.max} (recibido ${parsed}).`);
      return fallback;
    }
    return parsed;
  }

  optionalInt(key: string): number | undefined {
    const value = this.raw(key);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      this.errors.push(`${key} debe ser un número entero (recibido "${value}").`);
      return undefined;
    }
    return parsed;
  }

  bool(key: string, fallback: boolean): boolean {
    const value = this.raw(key);
    if (value === undefined) return fallback;
    const lowered = value.toLowerCase();
    if (["1", "true", "yes", "on"].includes(lowered)) return true;
    if (["0", "false", "no", "off"].includes(lowered)) return false;
    this.errors.push(`${key} debe ser booleano (true/false). Recibido "${value}".`);
    return fallback;
  }

  enum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    const value = this.raw(key);
    if (value === undefined) return fallback;
    if (!allowed.includes(value as T)) {
      this.errors.push(
        `${key} debe ser uno de: ${allowed.join(", ")} (recibido "${value}").`,
      );
      return fallback;
    }
    return value as T;
  }

  list(key: string): string[] {
    const value = this.raw(key);
    if (value === undefined) return [];
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
}

export function loadConfig(env: Env = process.env): AppConfig {
  const reader = new EnvReader(env);

  const transport = reader.enum("TRANSPORT", ["direct", "gateway"] as const, "direct");
  const chatId = reader.required("TELEGRAM_CHAT_ID");
  const threadId = reader.optionalInt("TELEGRAM_TOPIC_ID");
  const parseMode = reader.str("TELEGRAM_PARSE_MODE", "HTML");
  const messageLang = reader.enum("MESSAGE_LANG", ["es", "en"] as const, "es");

  // `direct` exige token; `gateway` no (el token vive en el gateway).
  const botToken =
    transport === "direct"
      ? reader.required("TELEGRAM_BOT_TOKEN")
      : reader.optional("TELEGRAM_BOT_TOKEN");

  const apiBaseUrl = reader.str("TELEGRAM_API_BASE_URL", "https://api.telegram.org").replace(/\/+$/, "");
  const pollTimeoutSec = reader.int("TELEGRAM_POLL_TIMEOUT", 30, { min: 1 });

  const gatewayUrl = reader.str("TG_GATEWAY_URL", "http://127.0.0.1:4000").replace(/\/+$/, "");
  const webhookHost = reader.str("WEBHOOK_HOST", "127.0.0.1");
  const webhookPort = reader.int("WEBHOOK_PORT", 14120, { min: 1, max: 65535 });
  const gatewayReregisterMs = reader.int("GATEWAY_REREGISTER_MS", 60000, { min: 0 });

  const fail2banLogPath = reader.str("FAIL2BAN_LOG_PATH", "/var/log/fail2ban.log");
  // Si la variable no existe → default; si existe pero vacía → lista vacía
  // (permite desactivar explícitamente el conjunto de jails permanentes).
  const permanentJails =
    env.F2B_PERMANENT_JAILS === undefined ? ["recidive"] : reader.list("F2B_PERMANENT_JAILS");
  const ignoreJails = reader.list("F2B_IGNORE_JAILS");
  const ignoreIps = reader.list("F2B_IGNORE_IPS");
  const suppressShutdownFlush = reader.bool("F2B_SUPPRESS_SHUTDOWN_FLUSH", true);
  const pollIntervalMs = reader.int("F2B_POLL_INTERVAL_MS", 1000, { min: 50 });

  const notifyMode = reader.enum("NOTIFY_MODE", ["instant", "batch"] as const, "instant");
  const batchWindowSec = reader.int("BATCH_WINDOW_SEC", 3600, { min: 1 });
  if (!Number.isInteger(86400 / batchWindowSec)) {
    reader.errors.push(
      `BATCH_WINDOW_SEC debe ser un divisor de 86400 (recibido ${batchWindowSec}).`,
    );
  }
  const batchShowIps = reader.bool("BATCH_SHOW_IPS", false);
  const batchMaxEvents = reader.int("BATCH_MAX_EVENTS", 0, { min: 0 });
  const instantJails = reader.list("NOTIFY_INSTANT_JAILS");
  const notifyUnbans = reader.enum("NOTIFY_UNBANS", ["count", "off", "list"] as const, "count");

  const counterBackend = reader.enum(
    "COUNTER_BACKEND",
    ["file", "postgres"] as const,
    "file",
  );
  const counterFile = reader.str("COUNTER_FILE", "./data/f2b-counter.json");

  const database: DatabaseConfig = {
    host: reader.str("DB_HOST", "localhost"),
    port: reader.int("DB_PORT", 5432, { min: 1, max: 65535 }),
    database: reader.str("DB_NAME", "f2b"),
    user: reader.str("DB_USER", "f2b"),
    password: reader.str("DB_PASSWORD", ""),
  };

  const logLevel = reader.enum("LOG_LEVEL", LOG_LEVELS, "info");
  const logFile = reader.optional("LOG_FILE");

  if (reader.errors.length > 0) {
    throw new ConfigError(
      `Configuración inválida:\n- ${reader.errors.join("\n- ")}`,
    );
  }

  return {
    transport,
    chatId,
    ...(threadId !== undefined ? { threadId } : {}),
    parseMode,
    messageLang,
    ...(botToken !== undefined ? { botToken } : {}),
    apiBaseUrl,
    pollTimeoutSec,
    gatewayUrl,
    webhookHost,
    webhookPort,
    gatewayReregisterMs,
    fail2banLogPath,
    permanentJails,
    ignoreJails,
    ignoreIps,
    suppressShutdownFlush,
    pollIntervalMs,
    notifyMode,
    batchWindowSec,
    batchShowIps,
    batchMaxEvents,
    instantJails,
    notifyUnbans,
    counterBackend,
    counterFile,
    database,
    logLevel,
    ...(logFile !== undefined ? { logFile } : {}),
  };
}
