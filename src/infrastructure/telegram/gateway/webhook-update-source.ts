// Adaptador `UpdateSourcePort` para el transporte `gateway`.
//
//   - Levanta un servidor HTTP local que recibe en `POST /tg-update` el update
//     CRUDO de Telegram que reenvía tg-gateway (forwarder.ts:22-56; el gateway
//     espera un 2xx).
//   - Registra los comandos/callbacks en tg-gateway
//     (`POST /api/register-handler { command, webhook }`, api-server.ts:215-227).
//     El gateway NO persiste handlers, así que se re-registran periódicamente
//     (decisión 14) para sobrevivir a un reinicio del gateway.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { LoggerPort } from "../../../domain/ports/logger.ts";
import type { UpdateHandler, UpdateSourcePort } from "../../../domain/ports/update-source.ts";
import { normalizeUpdate } from "../normalize-update.ts";

export interface WebhookUpdateSourceOptions {
  host: string;
  port: number;
  gatewayUrl: string;
  /** Comandos y datos de callback a registrar (p. ej. "/f2b", "show_counter"). */
  commands: string[];
  /** Intervalo de re-registro en ms; 0 lo desactiva. */
  reregisterMs: number;
  logger: LoggerPort;
  fetchImpl?: typeof fetch;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class WebhookUpdateSource implements UpdateSourcePort {
  private server: Server | undefined;
  private reregisterTimer: NodeJS.Timeout | undefined;
  private boundPort = 0;
  private handler: UpdateHandler | undefined;

  constructor(private readonly options: WebhookUpdateSourceOptions) {}

  /** Puerto real donde escucha (útil cuando se pide el 0 efímero en tests). */
  get port(): number {
    return this.boundPort;
  }

  get webhookUrl(): string {
    return `http://${this.options.host}:${this.boundPort}/tg-update`;
  }

  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  async start(handler: UpdateHandler): Promise<void> {
    this.handler = handler;
    this.server = createServer((request, response) => {
      void this.onRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.options.port, this.options.host, () => {
        const address = this.server?.address();
        this.boundPort =
          address !== null && typeof address === "object" ? address.port : this.options.port;
        resolve();
      });
    });

    this.options.logger.info("Webhook de updates escuchando.", {
      url: this.webhookUrl,
    });

    await this.registerHandlers();
    if (this.options.reregisterMs > 0) {
      this.reregisterTimer = setInterval(() => {
        void this.registerHandlers();
      }, this.options.reregisterMs);
      this.reregisterTimer.unref?.();
    }
  }

  async stop(): Promise<void> {
    if (this.reregisterTimer !== undefined) {
      clearInterval(this.reregisterTimer);
      this.reregisterTimer = undefined;
    }
    this.handler = undefined;
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async onRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== "POST" || request.url !== "/tg-update") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "not found" }));
      return;
    }

    try {
      const body = await readBody(request);
      const raw: unknown = JSON.parse(body);
      const update = normalizeUpdate(raw);
      if (update !== null && this.handler !== undefined) {
        await this.handler(update);
      }
    } catch (error) {
      // Nunca devolvemos error al gateway por un update malformado: se registra
      // y se responde 200 (el gateway no reintenta de todos modos).
      this.options.logger.error("Error procesando update del gateway.", {
        error: errorText(error),
      });
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  }

  private async registerHandlers(): Promise<void> {
    for (const command of this.options.commands) {
      try {
        const response = await this.fetchImpl(
          `${this.options.gatewayUrl}/api/register-handler`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command, webhook: this.webhookUrl }),
            signal: AbortSignal.timeout(10000),
          },
        );
        if (response.ok) {
          this.options.logger.info("Handler registrado en el gateway.", { command });
        } else {
          this.options.logger.warn("No se pudo registrar el handler.", {
            command,
            status: response.status,
          });
        }
      } catch (error) {
        this.options.logger.warn("Error registrando handler en el gateway.", {
          command,
          error: errorText(error),
        });
      }
    }
  }
}
