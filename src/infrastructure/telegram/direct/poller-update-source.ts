// Adaptador `UpdateSourcePort` para el transporte `direct`: long-polling con
// `getUpdates` de la Bot API. Reemplaza al webhook/registro del gateway.
//
// El bucle corre en segundo plano: `start` resuelve en cuanto se lanza y
// `stop` aborta el fetch en curso. Ante error de red, se reintenta con backoff
// fijo para no martillear la API.
import type { IncomingUpdate } from "../../../domain/entities/incoming-update.ts";
import type { LoggerPort } from "../../../domain/ports/logger.ts";
import type { UpdateHandler, UpdateSourcePort } from "../../../domain/ports/update-source.ts";
import { normalizeUpdate } from "../normalize-update.ts";

export interface PollerUpdateSourceOptions {
  token: string;
  apiBaseUrl: string;
  pollTimeoutSec: number;
  logger: LoggerPort;
  /** Backoff en ms entre reintentos tras un error. Por defecto: 5000. */
  backoffMs?: number;
  /** `stop` aborta el fetch en curso. */
  fetchImpl?: typeof fetch;
}

interface GetUpdatesResponse {
  ok?: boolean;
  description?: string;
  result?: unknown[];
}

const DEFAULT_BACKOFF_MS = 5000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PollerUpdateSource implements UpdateSourcePort {
  private running = false;
  private controller: AbortController | undefined;
  private loopPromise: Promise<void> | undefined;
  private offset = 0;

  constructor(private readonly options: PollerUpdateSourceOptions) {}

  async start(handler: UpdateHandler): Promise<void> {
    this.running = true;
    this.loopPromise = this.loop(handler);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.controller?.abort();
    try {
      await this.loopPromise;
    } catch {
      // Errores ya registrados en el bucle.
    }
    this.loopPromise = undefined;
  }

  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  private async loop(handler: UpdateHandler): Promise<void> {
    const backoff = this.options.backoffMs ?? DEFAULT_BACKOFF_MS;
    while (this.running) {
      try {
        await this.pollOnce(handler);
      } catch (error) {
        if (!this.running) break;
        this.options.logger.warn("Error en getUpdates; reintentando.", {
          error: errorText(error),
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  private async pollOnce(handler: UpdateHandler): Promise<void> {
    this.controller = new AbortController();
    const timeoutMs = (this.options.pollTimeoutSec + 10) * 1000;
    const url =
      `${this.options.apiBaseUrl}/bot${this.options.token}/getUpdates` +
      `?timeout=${this.options.pollTimeoutSec}&offset=${this.offset}`;

    const response = await this.fetchImpl(url, {
      signal: AbortSignal.any([
        this.controller.signal,
        AbortSignal.timeout(timeoutMs),
      ]),
    });
    if (!response.ok) {
      throw new Error(`getUpdates devolvió HTTP ${response.status}`);
    }
    const json = (await response.json()) as GetUpdatesResponse;
    if (json.ok === false) {
      throw new Error(`getUpdates falló: ${json.description ?? "ok=false"}`);
    }

    for (const raw of json.result ?? []) {
      const updateId = (raw as { update_id?: number }).update_id;
      if (typeof updateId === "number") {
        this.offset = Math.max(this.offset, updateId + 1);
      }
      const normalized: IncomingUpdate | null = normalizeUpdate(raw);
      if (normalized !== null) await handler(normalized);
    }
  }
}
