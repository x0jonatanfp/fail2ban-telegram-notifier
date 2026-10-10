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
import type { LogEvent } from "../domain/ports/event-source.ts";
import type { NotifierPort } from "../domain/ports/notifier.ts";
import type { CounterStorePort } from "../domain/ports/counter-store.ts";
import type { LoggerPort } from "../domain/ports/logger.ts";
import type { MessageTemplates } from "../domain/services/message-format.ts";
import { parseFail2banLine } from "../domain/services/parse-fail2ban-line.ts";
import { ShutdownSuppressor } from "../domain/services/shutdown-suppressor.ts";
import { applyBan } from "../domain/services/counter-rules.ts";
import { formatLocalTime } from "../domain/services/format-time.ts";
import { errText } from "./error-text.ts";

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
}

export class NotifyFail2banEventsUseCase {
  private readonly suppressor = new ShutdownSuppressor();

  constructor(private readonly deps: NotifyFail2banEventsDeps) {}

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
      // Cualquier ban real reactiva los avisos (f2b.py:79).
      this.suppressor.reactivate();
      if (this.isIgnored(entry.jail, entry.ip)) {
        this.deps.logger.info("Ban ignorado por filtro.", {
          jail: entry.jail,
          ip: entry.ip,
        });
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
      await this.sendUnban(entry.ip, entry.jail);
    }
  }

  private isIgnored(jail: string, ip: string): boolean {
    return this.deps.ignoreJails.has(jail) || this.deps.ignoreIps.has(ip);
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
