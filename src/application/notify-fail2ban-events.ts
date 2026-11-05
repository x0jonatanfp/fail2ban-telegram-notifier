// Caso de uso: consumir eventos del log de fail2ban y notificarlos.
//
// Replica `read_log` + `_send_ban` + `_send_unban` del original (f2b.py:27-130),
// pero separando la E/S (tail, notifier, store) del juicio de dominio:
//   - `parseFail2banLine` + `ShutdownSuppressor` + `applyBan` son puros.
//   - Aquí solo se orquesta el orden de llamadas y se registran trazas.
//
// Orden de decisión por línea (idéntico a f2b.py:58-88): primero marcadores de
// apagado/arranque; después `fail2ban.actions`; y dentro, `Ban` reactiva y
// `Unban` se suprime si estamos en modo apagado. Cualquier otra acción
// (`Found`, etc.) se ignora porque solo se notifican Ban/Unban.
//
// Modo `batch` (opcional, `NOTIFY_MODE=batch`): en vez de un mensaje por
// evento, los bans/unbans se acumulan en un `BatchBuffer` en memoria y cada
// ventana alineada se envía un resumen de una sola línea
// (`formatBatchSummary`). El modo `instant` (por defecto) conserva el
// comportamiento original mensaje por mensaje.
import type { LogEvent } from "../domain/ports/event-source.ts";
import type { NotifierPort } from "../domain/ports/notifier.ts";
import type { CounterStorePort } from "../domain/ports/counter-store.ts";
import type { LoggerPort } from "../domain/ports/logger.ts";
import type { MessageTemplates } from "../domain/services/message-format.ts";
import { parseFail2banLine } from "../domain/services/parse-fail2ban-line.ts";
import { ShutdownSuppressor } from "../domain/services/shutdown-suppressor.ts";
import { applyBan } from "../domain/services/counter-rules.ts";
import { formatLocalTime } from "../domain/services/format-time.ts";
import { windowFor, type BatchWindow } from "../domain/services/batch-window.ts";
import { BatchBuffer } from "../domain/services/batch-buffer.ts";
import { formatBatchSummary, type NotifyUnbansMode } from "../domain/services/batch-summary.ts";
import { errText } from "./error-text.ts";

export type NotifyMode = "instant" | "batch";

export interface NotifyFail2banEventsDeps {
  notifier: NotifierPort;
  counterStore: CounterStorePort;
  messages: MessageTemplates;
  logger: LoggerPort;
  /** Chat destino (fijo, como `CHAT_ID` en el original). */
  chatId: string;
  /** Tema destino; solo lo aplica el adaptador `direct`. */
  threadId?: number;
  permanentJails: ReadonlySet<string>;
  ignoreJails: ReadonlySet<string>;
  ignoreIps: ReadonlySet<string>;
  suppressShutdownFlush: boolean;
  /** Reloj inyectable para tests. */
  now: () => Date;
  /** Modo de notificación; `instant` por defecto (comportamiento original). */
  notifyMode?: NotifyMode;
  /** Ventana del resumen batch, en segundos (alineada a medianoche local). */
  batchWindowSec?: number;
  /** `true` añade las IPs en spoiler agrupadas por jail. */
  batchShowIps?: boolean;
  /** Si > 0, envía el resumen al alcanzar ese nº de eventos. 0 = sin tope. */
  batchMaxEvents?: number;
  /** Jails cuyos bans saltan el lote y se envían al instante. Solo batch. */
  instantJails?: ReadonlySet<string>;
  /** Cómo tratar los unbans en el resumen. */
  notifyUnbans?: NotifyUnbansMode;
  /** Temporizador inyectable para poder testear sin esperar (patrón daily-reset). */
  setTimer?: (callback: () => void, ms: number) => { unref?: () => void };
  clearTimer?: (handle: { unref?: () => void }) => void;
}

export class NotifyFail2banEventsUseCase {
  private readonly suppressor = new ShutdownSuppressor();
  private readonly buffer = new BatchBuffer();
  private window: BatchWindow | undefined;
  private timer: { unref?: () => void } | undefined;
  private flushing = false;

  constructor(private readonly deps: NotifyFail2banEventsDeps) {}

  private get mode(): NotifyMode {
    return this.deps.notifyMode ?? "instant";
  }

  /** Arranca la ventana batch (en `instant` no hace nada). Idempotente. */
  start(): void {
    if (this.mode !== "batch" || this.timer !== undefined) return;
    this.window = windowFor(this.deps.now(), this.deps.batchWindowSec ?? 3600);
    this.scheduleLocked();
  }

  /** Para el temporizador de la ventana (no vacía el buffer; usa `flush`). */
  stop(): void {
    if (this.timer !== undefined) {
      const clear =
        this.deps.clearTimer ?? ((h: { unref?: () => void }) => clearTimeout(h as NodeJS.Timeout));
      clear(this.timer);
      this.timer = undefined;
    }
  }

  /** Envía el resumen pendiente, si hay eventos visibles. Para el apagado. */
  async flush(): Promise<void> {
    if (this.mode !== "batch") return;
    if (this.flushing) return;
    this.flushing = true;
    try {
      await this.flushLocked(this.window ?? windowFor(this.deps.now(), this.deps.batchWindowSec ?? 3600));
    } finally {
      this.flushing = false;
    }
  }

  async handle(event: LogEvent): Promise<void> {
    if (event.kind === "rotation") {
      await this.sendRotation(event.reason);
      return;
    }
    const line = event.raw;

    // 1) Marcadores de apagado/arranque (se comprueban en TODA línea).
    if (this.deps.suppressShutdownFlush) {
      const marker = this.suppressor.observeMarker(line);
      if (marker !== null) {
        this.deps.logger.info(
          marker === "shutdown"
            ? "fail2ban apagándose: suprimiendo unbans del flush."
            : "fail2ban arrancando: se reanudan los avisos.",
          { marker },
        );
        return;
      }
    }

    // 2) Solo líneas de `fail2ban.actions` con acción reconocible.
    const entry = parseFail2banLine(line);
    if (entry === null) return;

    if (entry.action === "Ban") {
      // Cualquier ban real reactiva y vuelve a notificar (f2b.py:79).
      this.suppressor.reactivate();
      if (this.isIgnored(entry.jail, entry.ip)) {
        this.deps.logger.info("Ban ignorado por filtro.", {
          jail: entry.jail,
          ip: entry.ip,
        });
        return;
      }
      // En batch, las jails instantáneas siguen el camino original y NO se
      // recuentan después en el resumen.
      if (this.mode === "batch" && (this.deps.instantJails?.has(entry.jail) ?? false)) {
        await this.sendBan(entry.ip, entry.jail);
        return;
      }
      if (this.mode === "batch") {
        this.enqueueBan(entry.ip, entry.jail);
        return;
      }
      await this.sendBan(entry.ip, entry.jail);
      return;
    }

    if (entry.action === "Unban") {
      if (this.deps.suppressShutdownFlush && this.suppressor.isSuppressing()) {
        this.deps.logger.info("Unban suprimido (flush de apagado).", {
          jail: entry.jail,
          ip: entry.ip,
        });
        return;
      }
      if (this.isIgnored(entry.jail, entry.ip)) {
        this.deps.logger.info("Unban ignorado por filtro.", {
          jail: entry.jail,
          ip: entry.ip,
        });
        return;
      }
      if (this.mode === "batch") {
        this.enqueueUnban(entry.ip, entry.jail);
        return;
      }
      await this.sendUnban(entry.ip, entry.jail);
    }
  }

  private isIgnored(jail: string, ip: string): boolean {
    return this.deps.ignoreJails.has(jail) || this.deps.ignoreIps.has(ip);
  }

  private enqueueBan(ip: string, jail: string): void {
    this.ensureWindow();
    this.buffer.addBan(ip, jail);
    this.deps.logger.info("Ban encolado en el lote.", { ip, jail });
    this.maybeFlushEarly();
  }

  private enqueueUnban(ip: string, jail: string): void {
    // Con `off` los unbans ni se encolan (ahorra memoria con el mismo
    // resultado visible: el resumen los omite y una ventana de solo-unbans
    // no envía nada).
    if ((this.deps.notifyUnbans ?? "count") === "off") {
      this.deps.logger.info("Unban omitido (NOTIFY_UNBANS=off).", { ip, jail });
      return;
    }
    this.ensureWindow();
    this.buffer.addUnban(ip, jail);
    this.deps.logger.info("Unban encolado en el lote.", { ip, jail });
    this.maybeFlushEarly();
  }

  private ensureWindow(): void {
    if (this.window === undefined) {
      this.window = windowFor(this.deps.now(), this.deps.batchWindowSec ?? 3600);
    }
  }

  private maybeFlushEarly(): void {
    const max = this.deps.batchMaxEvents ?? 0;
    // Porqué no se espera al timer: con `BATCH_MAX_EVENTS` el resumen sale
    // antes de tiempo y la ventana siguiente empieza ahí (el buffer se vacía
    // y el temporizador se reprograma al fin de la ventana alineada).
    if (max > 0 && this.buffer.size >= max && !this.flushing) {
      void this.flush();
    }
  }

  private scheduleLocked(): void {
    if (this.window === undefined) return;
    const ms = Math.max(this.window.end.getTime() - this.deps.now().getTime(), 0);
    const set =
      this.deps.setTimer ?? ((cb: () => void, delay: number) => setTimeout(cb, delay));
    this.timer = set(() => {
      void this.onWindowTimer();
    }, ms);
    this.timer.unref?.();
  }

  private rescheduleLocked(): void {
    this.stop();
    this.ensureWindow();
    // Tras un flush anticipado la ventana siguiente empieza ahí: se conserva
    // la alineación al reloj local reprogramando al fin de la ventana que
    // contiene a `now` (cabeceras siempre alineadas, p. ej. 14:00–15:00).
    this.window = windowFor(this.deps.now(), this.deps.batchWindowSec ?? 3600);
    this.scheduleLocked();
  }

  private async onWindowTimer(): Promise<void> {
    this.timer = undefined;
    const fired = this.deps.now();
    const snapshot = this.window ?? windowFor(fired, this.deps.batchWindowSec ?? 3600);
    if (!this.flushing) {
      this.flushing = true;
      try {
        await this.flushLocked(snapshot);
      } finally {
        this.flushing = false;
      }
    }
    // Avanza a la ventana alineada siguiente y reprograma.
    this.window = windowFor(snapshot.end, this.deps.batchWindowSec ?? 3600);
    this.scheduleLocked();
  }

  private async flushLocked(snapshot: BatchWindow): Promise<void> {
    if (this.buffer.isEmpty) return;
    const { bans, unbans } = this.buffer.snapshot();
    const unbanMode = this.deps.notifyUnbans ?? "count";
    const texts = formatBatchSummary(
      {
        windowStart: snapshot.start,
        windowEnd: snapshot.end,
        bans,
        // Con `off` ya ni se encolan, pero se filtra de nuevo por seguridad.
        unbans: unbanMode === "off" ? [] : unbans,
        showIps: this.deps.batchShowIps ?? false,
        unbanMode,
      },
      this.deps.messages,
    );
    if (texts.length === 0) {
      // Solo-unbans con `off`: se descartan sin enviar.
      this.buffer.clear();
      return;
    }
    if (this.buffer.droppedCount > 0) {
      this.deps.logger.warn("Buffer del lote lleno: se descartaron eventos antiguos.", {
        dropped: this.buffer.droppedCount,
      });
    }
    try {
      for (const text of texts) {
        await this.deps.notifier.sendMessage(this.deps.chatId, text, this.sendOptions());
      }
    } catch (error) {
      // Reintento seguro: se conservan los eventos para la siguiente ventana
      // (el buffer tiene tope, así que un fallo sostenido no crece sin
      // límite). El contador NO se actualiza si el envío falla (igual que
      // en instantáneo).
      this.deps.logger.error("Error enviando el resumen del lote; se reintentará.", {
        error: errText(error),
      });
      return;
    }
    // Contador: UNA actualización por resumen con éxito con todos los bans
    // del lote (misma regla que hoy: si el envío falla, no se actualiza).
    try {
      const state = await this.deps.counterStore.load();
      const at = formatLocalTime(this.deps.now());
      let next = state;
      for (const ban of bans) {
        next = applyBan(next, ban.jail, this.deps.permanentJails, at);
      }
      // Solo guarda si hubo bans (los unbans no tocan el contador).
      if (bans.length > 0) await this.deps.counterStore.save(next);
      this.buffer.clear();
      this.deps.logger.info("Resumen del lote enviado.", {
        bans: bans.length,
        unbans: unbanMode === "off" ? 0 : unbans.length,
        messages: texts.length,
      });
    } catch (error) {
      // El resumen ya salió: se vacía para no duplicarlo en el reintento y
      // se registra el fallo del contador.
      this.buffer.clear();
      this.deps.logger.error("Resumen enviado pero falló la actualización del contador.", {
        error: errText(error),
      });
    }
  }

  private async sendBan(ip: string, jail: string): Promise<void> {
    try {
      // Orden del original (f2b.py:103-118): cargar, enviar, actualizar. Si el
      // envío falla, el contador NO se actualiza.
      const state = await this.deps.counterStore.load();
      const at = formatLocalTime(this.deps.now());
      const permanent = this.deps.permanentJails.has(jail);
      const text = permanent
        ? this.deps.messages.permanentBan(ip, jail)
        : this.deps.messages.ban(ip, jail);

      await this.deps.notifier.sendMessage(this.deps.chatId, text, this.sendOptions());

      const next = applyBan(state, jail, this.deps.permanentJails, at);
      await this.deps.counterStore.save(next);

      this.deps.logger.info(
        permanent ? "Bloqueo permanente notificado." : "Bloqueo notificado.",
        { ip, jail, permanent },
      );
    } catch (error) {
      this.deps.logger.error("Error enviando mensaje de ban.", {
        ip,
        jail,
        error: errText(error),
      });
    }
  }

  private async sendUnban(ip: string, jail: string): Promise<void> {
    try {
      const text = this.deps.messages.unban(ip, jail);
      await this.deps.notifier.sendMessage(this.deps.chatId, text, this.sendOptions());
      this.deps.logger.info("IP desbloqueada.", { ip, jail });
    } catch (error) {
      this.deps.logger.error("Error enviando mensaje de unban.", {
        ip,
        jail,
        error: errText(error),
      });
    }
  }

  private async sendRotation(reason: "size" | "inode"): Promise<void> {
    try {
      const text =
        reason === "size"
          ? this.deps.messages.logRotationSize()
          : this.deps.messages.logRotationInode();
      await this.deps.notifier.sendMessage(this.deps.chatId, text, this.sendOptions());
      this.deps.logger.info("Aviso de rotación de log enviado.", { reason });
    } catch (error) {
      this.deps.logger.error("Error enviando aviso de rotación.", {
        reason,
        error: errText(error),
      });
    }
  }

  private sendOptions(): { threadId?: number } {
    return this.deps.threadId !== undefined ? { threadId: this.deps.threadId } : {};
  }
}
