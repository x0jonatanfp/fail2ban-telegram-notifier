// Puerto `UpdateSourcePort`: origen de updates entrantes de Telegram.
// Adaptadores: `poller-update-source` (direct, getUpdates) y
// `webhook-update-source` (gateway, servidor HTTP).
import type { IncomingUpdate } from "../entities/incoming-update.ts";

export type UpdateHandler = (update: IncomingUpdate) => Promise<void>;

export interface UpdateSourcePort {
  /** Arranca la fuente. Resuelve cuando está lista (el bucle corre en 2.º plano). */
  start(handler: UpdateHandler): Promise<void>;
  /** Detiene la fuente y libera recursos (sockets, timers). */
  stop(): Promise<void>;
}
