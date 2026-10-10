// Caso de uso: mostrar los valores del contador (callback `show_counter`).
// Réplica de `handle_show_counter` (f2b.py:158-179): responde el callback (lo
// hace el orquestador), envía el mensaje con el teclado y lo autoborra a los 6 s.
import type { NotifierPort } from "../domain/ports/notifier.ts";
import type { CounterStorePort } from "../domain/ports/counter-store.ts";
import type { LoggerPort } from "../domain/ports/logger.ts";
import type { MessageTemplates } from "../domain/services/message-format.ts";
import { errText } from "./error-text.ts";

/** Retardo del autoborrado, en ms (f2b.py:178). */
export const COUNTER_AUTO_DELETE_MS = 6000;

export interface ShowCounterDeps {
  notifier: NotifierPort;
  counterStore: CounterStorePort;
  messages: MessageTemplates;
  logger: LoggerPort;
  chatId: string;
  threadId?: number;
  delay: (ms: number) => Promise<void>;
}

export class ShowCounterUseCase {
  constructor(private readonly deps: ShowCounterDeps) {}

  async execute(): Promise<void> {
    const state = await this.deps.counterStore.load();
    const result = await this.deps.notifier.sendMessage(
      this.deps.chatId,
      this.deps.messages.counterTitle(),
      {
        replyMarkup: this.deps.messages.counterKeyboard(state),
        ...(this.deps.threadId !== undefined ? { threadId: this.deps.threadId } : {}),
      },
    );

    if (result.messageId !== undefined) {
      this.scheduleDelete(result.messageId);
    }
  }

  private scheduleDelete(messageId: number): void {
    void this.deps
      .delay(COUNTER_AUTO_DELETE_MS)
      .then(() => this.deps.notifier.deleteMessage(this.deps.chatId, messageId))
      .catch((error) =>
        this.deps.logger.warn("No se pudo borrar el mensaje del contador.", {
          messageId,
          error: errText(error),
        }),
      );
  }
}
