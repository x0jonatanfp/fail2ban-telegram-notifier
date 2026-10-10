// Utilidades compartidas por los tests: dobles de puertos y un servidor HTTP
// falso local. Ningún test habla con Telegram real.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { LoggerPort, LogLevel, LogMeta } from "../../src/domain/ports/logger.ts";
import type { NotifierPort } from "../../src/domain/ports/notifier.ts";
import type {
  InlineKeyboardMarkup,
  SendMessageOptions,
  SendMessageResult,
} from "../../src/domain/entities/telegram-message.ts";
import type { CounterStorePort } from "../../src/domain/ports/counter-store.ts";
import type { CounterState } from "../../src/domain/entities/counter-state.ts";
import { emptyCounterState } from "../../src/domain/entities/counter-state.ts";

export interface LogEntry {
  level: LogLevel;
  message: string;
  meta?: LogMeta;
}

export interface TestLogger extends LoggerPort {
  entries: LogEntry[];
  messagesOf(level: LogLevel): string[];
}

/** Logger que acumula entradas en memoria en vez de escribir a consola. */
export function createTestLogger(): TestLogger {
  const entries: LogEntry[] = [];
  const record =
    (level: LogLevel) =>
    (message: string, meta?: LogMeta): void => {
      entries.push(meta !== undefined ? { level, message, meta } : { level, message });
    };
  return {
    entries,
    messagesOf: (level) => entries.filter((e) => e.level === level).map((e) => e.message),
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
}

export interface SentMessage {
  chatId: string;
  text: string;
  options?: SendMessageOptions;
}

export interface DeletedMessage {
  chatId: string;
  messageId: number;
}

export interface AnsweredCallback {
  callbackId: string;
  text?: string;
}

/** Doble de `NotifierPort` que registra las llamadas. */
export class FakeNotifier implements NotifierPort {
  sent: SentMessage[] = [];
  deleted: DeletedMessage[] = [];
  answered: AnsweredCallback[] = [];
  edited: Array<{ chatId: string; messageId: number; replyMarkup: InlineKeyboardMarkup }> = [];
  nextMessageId = 1000;

  async sendMessage(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<SendMessageResult> {
    this.sent.push(options !== undefined ? { chatId, text, options } : { chatId, text });
    const messageId = this.nextMessageId;
    this.nextMessageId += 1;
    return { messageId };
  }

  async deleteMessage(chatId: string, messageId: number): Promise<void> {
    this.deleted.push({ chatId, messageId });
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    this.answered.push(text !== undefined ? { callbackId, text } : { callbackId });
  }

  async editReplyMarkup(
    chatId: string,
    messageId: number,
    replyMarkup: InlineKeyboardMarkup,
  ): Promise<void> {
    this.edited.push({ chatId, messageId, replyMarkup });
  }
}

/** Doble en memoria de `CounterStorePort`. */
export class InMemoryCounterStore implements CounterStorePort {
  state: CounterState = emptyCounterState();
  saves: CounterState[] = [];

  constructor(initial?: CounterState) {
    if (initial !== undefined) this.state = { ...initial };
  }

  async load(): Promise<CounterState> {
    return { ...this.state };
  }

  async save(state: CounterState): Promise<void> {
    this.state = { ...state };
    this.saves.push({ ...state });
  }
}

export interface CapturedRequest {
  method?: string;
  url?: string;
  body: unknown;
  headers: IncomingMessage["headers"];
}

export interface FakeServer {
  url: string;
  port: number;
  requests: CapturedRequest[];
  close(): Promise<void>;
}

export type FakeHandler = (
  request: IncomingMessage,
  body: unknown,
  response: ServerResponse,
) => void | Promise<void>;

/** Levanta un servidor HTTP falso en un puerto efímero de loopback. */
export async function startFakeServer(handler: FakeHandler): Promise<FakeServer> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      try {
        body = raw === "" ? undefined : JSON.parse(raw);
      } catch {
        body = raw;
      }
      requests.push({
        method: request.method,
        url: request.url,
        body,
        headers: request.headers,
      });
      await handler(request, body, response);
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address !== null && typeof address === "object" ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export function jsonResponse(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

/** Directorio temporal aislado (respeta `TMPDIR`). */
export async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "f2b-test-"));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Espera a que una condición se cumpla o se agote el tiempo. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: tiempo agotado esperando la condición");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
