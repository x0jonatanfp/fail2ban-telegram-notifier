import { describe, expect, it, vi } from "vitest";
import { ShowCounterUseCase } from "../../src/application/show-counter.ts";
import { getMessages } from "../../src/domain/services/message-format.ts";
import type { NotifierPort } from "../../src/domain/ports/notifier.ts";
import { createTestLogger, FakeNotifier, InMemoryCounterStore } from "../test/helpers.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ShowCounterUseCase", () => {
  it("envía el contador y lo autoborra a los 6 s", async () => {
    const notifier = new FakeNotifier();
    const counterStore = new InMemoryCounterStore({
      daily: 3,
      permanent: 1,
      total: 10,
      last: "12:34:56",
    });
    const delays: number[] = [];
    const useCase = new ShowCounterUseCase({
      notifier,
      counterStore,
      messages: getMessages("es"),
      logger: createTestLogger(),
      chatId: "CHAT",
      delay: async (ms) => {
        delays.push(ms);
      },
    });

    await useCase.execute();
    await flush();

    expect(notifier.sent[0]?.text).toBe("<b>📊 CONTADOR DE BLOQUEOS</b>");
    expect(notifier.sent[0]?.options?.replyMarkup?.inline_keyboard).toHaveLength(4);
    expect(delays).toEqual([6000]);
    expect(notifier.deleted).toEqual([{ chatId: "CHAT", messageId: 1000 }]);
  });

  it("pasa el threadId al enviar el contador", async () => {
    const notifier = new FakeNotifier();
    const useCase = new ShowCounterUseCase({
      notifier,
      counterStore: new InMemoryCounterStore(),
      messages: getMessages("es"),
      logger: createTestLogger(),
      chatId: "CHAT",
      threadId: 7,
      delay: async () => undefined,
    });

    await useCase.execute();
    await flush();

    expect(notifier.sent[0]?.options?.threadId).toBe(7);
  });

  it("si el envío no devuelve messageId, no programa borrado", async () => {
    const notifier: NotifierPort = {
      sendMessage: async () => ({}),
      deleteMessage: async () => undefined,
      answerCallback: async () => undefined,
      editReplyMarkup: async () => undefined,
    };
    const delays: number[] = [];
    const useCase = new ShowCounterUseCase({
      notifier,
      counterStore: new InMemoryCounterStore(),
      messages: getMessages("es"),
      logger: createTestLogger(),
      chatId: "CHAT",
      delay: async (ms) => {
        delays.push(ms);
      },
    });

    await useCase.execute();
    await flush();

    expect(delays).toEqual([]);
  });

  it("si falla el autoborrado, avisa por warn y no revienta", async () => {
    const notifier: NotifierPort = {
      sendMessage: async () => ({ messageId: 5 }),
      deleteMessage: async () => {
        throw new Error("boom");
      },
      answerCallback: async () => undefined,
      editReplyMarkup: async () => undefined,
    };
    const logger = createTestLogger();
    const useCase = new ShowCounterUseCase({
      notifier,
      counterStore: new InMemoryCounterStore(),
      messages: getMessages("es"),
      logger,
      chatId: "CHAT",
      delay: async () => undefined,
    });

    await useCase.execute();
    await vi.waitFor(() => {
      expect(logger.messagesOf("warn")).toContain(
        "No se pudo borrar el mensaje del contador.",
      );
    });
  });
});
