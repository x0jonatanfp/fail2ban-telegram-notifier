// Composition root (arquitectura hexagonal): es el ÚNICO lugar que conoce a la
// vez `domain`, `application` e `infrastructure`. Valida la configuración,
// construye los adaptadores según `TRANSPORT`/`COUNTER_BACKEND` y arranca los
// casos de uso. Exporta `createRuntime` para poder montarlo en tests; solo se
// auto-arranca cuando se ejecuta como programa principal.
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import type { AppConfig } from "./infrastructure/config/env.ts";
import { ConfigError, loadConfig } from "./infrastructure/config/env.ts";
import { createLogger } from "./infrastructure/logging/logger.ts";
import { TailLogSource } from "./infrastructure/fail2ban/tail-log-source.ts";
import { DirectNotifier } from "./infrastructure/telegram/direct/direct-notifier.ts";
import { PollerUpdateSource } from "./infrastructure/telegram/direct/poller-update-source.ts";
import { GatewayNotifier } from "./infrastructure/telegram/gateway/gateway-notifier.ts";
import { WebhookUpdateSource } from "./infrastructure/telegram/gateway/webhook-update-source.ts";
import { FileCounterStore } from "./infrastructure/persistence/file-counter-store.ts";
import { PostgresCounterStore } from "./infrastructure/persistence/postgres-counter-store.ts";
import { getMessages } from "./domain/services/message-format.ts";
import type { CounterStorePort } from "./domain/ports/counter-store.ts";
import type { NotifierPort } from "./domain/ports/notifier.ts";
import type { UpdateSourcePort } from "./domain/ports/update-source.ts";
import { NotifyFail2banEventsUseCase } from "./application/notify-fail2ban-events.ts";
import { ShowCounterUseCase } from "./application/show-counter.ts";
import { ResetCounterUseCase } from "./application/reset-counter.ts";
import { HandleCommandUseCase } from "./application/handle-command.ts";
import { DailyResetScheduler } from "./application/daily-reset.ts";
import { errText } from "./application/error-text.ts";

/** Comandos y datos de callback que se registran en tg-gateway.
 *
 * Es el mismo conjunto que registraba el bot original y NO incluye /start ni
 * /help: en el gateway el registro es por coincidencia exacta y esos comandos
 * pueden pertenecer ya a otro servicio (p. ej. un agente con __default__);
 * registrarlos aquí se los robaría. En transporte `direct` sí se atienden,
 * porque los gestiona el poller del propio bot sin gateway de por medio. */
export const GATEWAY_COMMANDS = [
  "/f2b",
  "/chat_id",
  "show_counter",
  "not_touch",
] as const;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface Runtime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

function createNotifier(config: AppConfig): NotifierPort {
  if (config.transport === "gateway") {
    return new GatewayNotifier({
      gatewayUrl: config.gatewayUrl,
      parseMode: config.parseMode,
    });
  }
  // `direct`: validado en loadConfig (botToken obligatorio).
  return new DirectNotifier({
    token: config.botToken ?? "",
    apiBaseUrl: config.apiBaseUrl,
    parseMode: config.parseMode,
  });
}

function createCounterStore(
  config: AppConfig,
  logger: ReturnType<typeof createLogger>,
): { store: CounterStorePort; close: () => Promise<void> } {
  if (config.counterBackend === "postgres") {
    const store = new PostgresCounterStore(config.database, logger);
    return { store, close: () => store.close() };
  }
  const store = new FileCounterStore(config.counterFile, logger);
  return { store, close: async () => undefined };
}

function createUpdateSource(
  config: AppConfig,
  logger: ReturnType<typeof createLogger>,
): UpdateSourcePort {
  if (config.transport === "gateway") {
    return new WebhookUpdateSource({
      host: config.webhookHost,
      port: config.webhookPort,
      gatewayUrl: config.gatewayUrl,
      commands: [...GATEWAY_COMMANDS],
      reregisterMs: config.gatewayReregisterMs,
      logger,
    });
  }
  return new PollerUpdateSource({
    token: config.botToken ?? "",
    apiBaseUrl: config.apiBaseUrl,
    pollTimeoutSec: config.pollTimeoutSec,
    logger,
  });
}

export function createRuntime(config: AppConfig): Runtime {
  const logger = createLogger({
    level: config.logLevel,
    ...(config.logFile !== undefined ? { file: config.logFile } : {}),
  });
  const messages = getMessages(config.messageLang);
  const notifier = createNotifier(config);
  const { store, close } = createCounterStore(config, logger);
  const eventSource = new TailLogSource({
    filePath: config.fail2banLogPath,
    pollIntervalMs: config.pollIntervalMs,
    logger,
  });
  const updateSource = createUpdateSource(config, logger);

  const threadId = config.threadId;

  const notifyEvents = new NotifyFail2banEventsUseCase({
    notifier,
    counterStore: store,
    messages,
    logger,
    chatId: config.chatId,
    ...(threadId !== undefined ? { threadId } : {}),
    permanentJails: new Set(config.permanentJails),
    ignoreJails: new Set(config.ignoreJails),
    ignoreIps: new Set(config.ignoreIps),
    suppressShutdownFlush: config.suppressShutdownFlush,
    now: () => new Date(),
    notifyMode: config.notifyMode,
    batchWindowSec: config.batchWindowSec,
    batchShowIps: config.batchShowIps,
    batchMaxEvents: config.batchMaxEvents,
    instantJails: new Set(config.instantJails),
    notifyUnbans: config.notifyUnbans,
  });
  const showCounter = new ShowCounterUseCase({
    notifier,
    counterStore: store,
    messages,
    logger,
    chatId: config.chatId,
    ...(threadId !== undefined ? { threadId } : {}),
    delay,
  });
  const resetCounter = new ResetCounterUseCase({
    notifier,
    counterStore: store,
    messages,
    logger,
    chatId: config.chatId,
    ...(threadId !== undefined ? { threadId } : {}),
    now: () => new Date(),
  });
  const handleCommand = new HandleCommandUseCase({
    notifier,
    messages,
    logger,
    chatId: config.chatId,
    ...(threadId !== undefined ? { threadId } : {}),
    showCounter,
    resetCounter,
    delay,
  });
  const dailyReset = new DailyResetScheduler({
    resetCounter,
    logger,
    now: () => new Date(),
  });

  let started = false;

  return {
    async start(): Promise<void> {
      if (started) return;
      started = true;
      logger.info("Arrancando fail2ban-telegram-notifier.", {
        transport: config.transport,
        counterBackend: config.counterBackend,
        messageLang: config.messageLang,
        fail2banLogPath: config.fail2banLogPath,
        notifyMode: config.notifyMode,
      });
      notifyEvents.start();
      await eventSource.start((event) => notifyEvents.handle(event));
      await updateSource.start((update) => handleCommand.handle(update));
      dailyReset.start();
    },
    async stop(): Promise<void> {
      if (!started) return;
      started = false;
      logger.info("Parando…");
      dailyReset.stop();
      await updateSource.stop();
      await eventSource.stop();
      // Vacía el lote pendiente para que un SIGTERM normal no pierda hasta
      // una ventana de eventos (un `kill -9` o corte de energía sí la pierde:
      // el buffer es en memoria).
      await notifyEvents.flush();
      notifyEvents.stop();
      await close();
      logger.info("Detenido correctamente.");
    },
  };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  // Carga opcional de `.env` con la librería estándar de Node (sin dotenv).
  try {
    process.loadEnvFile();
  } catch {
    // No hay `.env`: se usan las variables del entorno tal cual.
  }

  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const runtime = createRuntime(config);

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`Recibida señal ${signal}; parando.\n`);
    void runtime
      .stop()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(`unhandledRejection: ${String(reason)}\n`);
  });

  await runtime.start();
}

if (isMainModule()) {
  // Un fallo al arrancar (p. ej. el puerto del webhook ocupado) es fatal: se
  // registra con claridad y se sale con código 1, en vez de quedarse a medias.
  void main().catch((error: unknown) => {
    process.stderr.write(`Fallo al arrancar: ${errText(error)}\n`);
    process.exit(1);
  });
}
