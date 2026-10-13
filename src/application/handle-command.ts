// Caso de uso: manejar los updates entrantes (comandos y callbacks).
//
// Réplica de `handle_tg_update` (main.py:51-83) más el enrutado:
//   - callback `show_counter` → ShowCounterUseCase
//   - callback `not_touch`   → ResetCounterUseCase
//   - `/f2b`, `/chat_id`     → comandos (f2b.py:133; user.py:8)
//   - `/start`, `/help`      → registrados/procesados (mejora: en el original
//     estaban sin `await`, luego no enviaban nada; aquí se corrigen)
// Las rutas de comando usan `startsWith` como el original (main.py:66-78), de
// modo que `/f2b@bot` también dispara el comando.
import type { IncomingUpdate } from "../domain/entities/incoming-update.ts";
import type { NotifierPort } from "../domain/ports/notifier.ts";
import type { LoggerPort } from "../domain/ports/logger.ts";
import type { InlineKeyboardMarkup } from "../domain/entities/telegram-message.ts";
import type { MessageTemplates } from "../domain/services/message-format.ts";
import type { ShowCounterUseCase } from "./show-counter.ts";
import type { ResetCounterUseCase } from "./reset-counter.ts";
import { errText } from "./error-text.ts";

/** Autoborrado del comando `/f2b`: mensaje del usuario a 6 s y del bot a 12 s
 * (f2b.py:145-155). */
export const USER_MESSAGE_DELETE_MS = 6000;
export const BOT_MESSAGE_DELETE_MS = 12000;

export interface HandleCommandDeps {
  notifier: NotifierPort;
  messages: MessageTemplates;
  logger: LoggerPort;
  /** Chat destino fijo (equivalente a `CHAT_ID` en el original). */
  chatId: string;
  threadId?: number;
  showCounter: ShowCounterUseCase;
  resetCounter: ResetCounterUseCase;
  delay: (ms: number) => Promise<void>;
}

export class HandleCommandUseCase {
  constructor(private readonly deps: HandleCommandDeps) {}

  async handle(update: IncomingUpdate): Promise<void> {
    try {
      if (update.kind === "callback") {
        await this.handleCallback(update);
        return;
      }
      await this.handleMessage(update);
    } catch (error) {
      this.deps.logger.error("Error manejando update.", {
        kind: update.kind,
        error: errText(error),
      });
    }
  }

  private async handleCallback(update: IncomingUpdate): Promise<void> {
    const data = update.callbackData ?? "";
    if (update.callbackId !== undefined) {
      await this.deps.notifier.answerCallback(update.callbackId);
    }
    if (data === "show_counter") {
      await this.deps.showCounter.execute();
    } else if (data === "not_touch") {
      await this.deps.resetCounter.execute();
    }
  }

  private async handleMessage(update: IncomingUpdate): Promise<void> {
    const text = (update.text ?? "").trim();

    if (text.startsWith("/f2b")) {
      await this.sendConfig(update);
      return;
    }
    if (text.startsWith("/chat_id")) {
      await this.sendSelfDeleting(
        update,
        this.deps.messages.chatIds({
          ...(update.userId !== undefined ? { userId: update.userId } : {}),
          chatId: update.chatId,
          ...(update.threadId !== undefined ? { threadId: update.threadId } : {}),
        }),
      );
      return;
    }
    if (text.startsWith("/start")) {
      await this.deps.notifier.sendMessage(
        this.deps.chatId,
        this.deps.messages.start(),
        this.sendOptions(),
      );
      return;
    }
    if (text.startsWith("/help")) {
      await this.deps.notifier.sendMessage(
        this.deps.chatId,
        this.deps.messages.help(),
        this.sendOptions(),
      );
    }
  }

  private async sendConfig(update: IncomingUpdate): Promise<void> {
    await this.sendSelfDeleting(update, this.deps.messages.configTitle(), {
      replyMarkup: this.deps.messages.configKeyboard(),
    });
  }

  /** Responde y programa el autoborrado del comando (mensaje del usuario a 6 s,
   * respuesta del bot a 12 s), igual que `/f2b`. */
  private async sendSelfDeleting(
    update: IncomingUpdate,
    text: string,
    extra: { replyMarkup?: InlineKeyboardMarkup } = {},
  ): Promise<void> {
    const result = await this.deps.notifier.sendMessage(this.deps.chatId, text, {
      ...extra,
      ...this.sendOptions(),
    });

    // Se programa el borrado SIN bloquear la respuesta al update (el original
    // esperaba 12 s dentro del handler, lo que podía agotar el timeout de 10 s
    // del gateway; el efecto observable —borrado a 6 s y 12 s— es el mismo).
    if (update.messageId !== undefined) {
      this.scheduleDelete(update.messageId, USER_MESSAGE_DELETE_MS);
    }
    if (result.messageId !== undefined) {
      this.scheduleDelete(result.messageId, BOT_MESSAGE_DELETE_MS);
    }
  }

  private scheduleDelete(messageId: number, delayMs: number): void {
    void this.deps
      .delay(delayMs)
      .then(() => this.deps.notifier.deleteMessage(this.deps.chatId, messageId))
      .catch((error) =>
        this.deps.logger.warn("No se pudo borrar el mensaje de /f2b.", {
          messageId,
          error: errText(error),
        }),
      );
  }

  private sendOptions(): { threadId?: number } {
    return this.deps.threadId !== undefined ? { threadId: this.deps.threadId } : {};
  }
}
