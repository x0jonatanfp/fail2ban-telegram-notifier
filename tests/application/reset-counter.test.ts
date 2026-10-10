import { describe, expect, it } from "vitest";
import { ResetCounterUseCase } from "../../src/application/reset-counter.ts";
import { getMessages } from "../../src/domain/services/message-format.ts";
import { createTestLogger, FakeNotifier, InMemoryCounterStore } from "../test/helpers.ts";

describe("ResetCounterUseCase", () => {
  it("acumula total, pone daily a 0 y muestra los valores previos", async () => {
    const notifier = new FakeNotifier();
    const counterStore = new InMemoryCounterStore({
      daily: 3,
      permanent: 2,
      total: 10,
      last: "09:00:00",
    });
    const useCase = new ResetCounterUseCase({
      notifier,
      counterStore,
      messages: getMessages("es"),
      logger: createTestLogger(),
      chatId: "CHAT",
      now: () => new Date(2026, 9, 10, 0, 0, 0),
    });

    const result = await useCase.execute();

    expect(result.next).toEqual({
      daily: 0,
      permanent: 2,
      total: 13,
      last: "00:00:00",
    });
    expect(counterStore.state).toEqual(result.next);
    expect(notifier.sent[0]?.text).toBe("<b>🔄 ¡CONTADOR REINICIADO!</b>");
    // El teclado muestra daily=3 (previo) y total=13 (nuevo).
    expect(notifier.sent[0]?.options?.replyMarkup).toEqual({
      inline_keyboard: [
        [{ text: "📊 Diarios: 3", callback_data: "noop" }],
        [{ text: "🚫 Reincidentes: 2", callback_data: "noop" }],
        [{ text: "🔒 Totales: 13", callback_data: "noop" }],
      ],
    });
  });

  it("pasa el threadId al enviar el mensaje de reinicio", async () => {
    const notifier = new FakeNotifier();
    const useCase = new ResetCounterUseCase({
      notifier,
      counterStore: new InMemoryCounterStore(),
      messages: getMessages("es"),
      logger: createTestLogger(),
      chatId: "CHAT",
      threadId: 9,
      now: () => new Date(2026, 9, 10, 0, 0, 0),
    });

    await useCase.execute();

    expect(notifier.sent[0]?.options?.threadId).toBe(9);
  });
});
