// Caso de uso: reiniciar el contador (botón `not_touch` y reinicio diario).
// Réplica de `handle_do_not_touch` (f2b.py:182-200) y del bloque de
// `scheduled_tasks` (scheduled_tasks.py:17-39):
//   total += daily; daily = 0; last = ahora; permanent se conserva.
// El mensaje de reinicio muestra los valores ANTERIORES de daily/permanent y el
// NUEVO total (por eso se construye con `previous` + `next`).
import type { CounterState } from "../domain/entities/counter-state.ts";
import type { NotifierPort } from "../domain/ports/notifier.ts";
import type { CounterStorePort } from "../domain/ports/counter-store.ts";
import type { LoggerPort } from "../domain/ports/logger.ts";
import type { MessageTemplates } from "../domain/services/message-format.ts";
import { applyReset } from "../domain/services/counter-rules.ts";
import { formatLocalTime } from "../domain/services/format-time.ts";

export interface ResetCounterDeps {
  notifier: NotifierPort;
  counterStore: CounterStorePort;
  messages: MessageTemplates;
  logger: LoggerPort;
  chatId: string;
  threadId?: number;
  now: () => Date;
}

export interface ResetCounterResult {
  previous: CounterState;
  next: CounterState;
}

export class ResetCounterUseCase {
  constructor(private readonly deps: ResetCounterDeps) {}

  async execute(): Promise<ResetCounterResult> {
    const previous = await this.deps.counterStore.load();
    const at = formatLocalTime(this.deps.now());
    const next = applyReset(previous, at);
    await this.deps.counterStore.save(next);

    await this.deps.notifier.sendMessage(
      this.deps.chatId,
      this.deps.messages.resetTitle(),
      {
        replyMarkup: this.deps.messages.resetKeyboard({
          daily: previous.daily,
          permanent: previous.permanent,
          total: next.total,
        }),
        ...(this.deps.threadId !== undefined ? { threadId: this.deps.threadId } : {}),
      },
    );

    this.deps.logger.info("Contador reiniciado.", {
      daily: next.daily,
      permanent: next.permanent,
      total: next.total,
    });
    return { previous, next };
  }
}
