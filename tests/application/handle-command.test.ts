import { beforeEach, describe, expect, it } from "vitest";
import { HandleCommandUseCase } from "../../src/application/handle-command.ts";
import { ShowCounterUseCase } from "../../src/application/show-counter.ts";
import { ResetCounterUseCase } from "../../src/application/reset-counter.ts";
import { getMessages } from "../../src/domain/services/message-format.ts";
import type { IncomingUpdate } from "../../src/domain/entities/incoming-update.ts";
import { createTestLogger, FakeNotifier, InMemoryCounterStore } from "../test/helpers.ts";

const NOW = new Date(2026, 9, 10, 12, 0, 0);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function build() {
  const notifier = new FakeNotifier();
  const counterStore = new InMemoryCounterStore({
    daily: 4,
    permanent: 2,
    total: 10,
    last: "11:00:00",
  });
  const logger = createTestLogger();
  const messages = getMessages("es");
  const delays: number[] = [];
  const delay = async (ms: number): Promise<void> => {
    delays.push(ms);
  };
  const showCounter = new ShowCounterUseCase({
    notifier,
    counterStore,
    messages,
    logger,
    chatId: "CHAT",
    delay,
  });
  const resetCounter = new ResetCounterUseCase({
    notifier,
    counterStore,
    messages,
    logger,
    chatId: "CHAT",
    now: () => NOW,
  });
  const useCase = new HandleCommandUseCase({
    notifier,
    messages,
    logger,
    chatId: "CHAT",
    showCounter,
    resetCounter,
    delay,
  });
  return { notifier, counterStore, logger, useCase, delays };
}

const messageUpdate = (text: string, extra: Partial<IncomingUpdate> = {}): IncomingUpdate => ({
  kind: "message",
  chatId: "CHAT",
  text,
  ...extra,
});

const callbackUpdate = (data: string): IncomingUpdate => ({
  kind: "callback",
  chatId: "CHAT",
  callbackId: "cb-1",
  callbackData: data,
});

describe("HandleCommandUseCase", () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it("/f2b envía el mensaje de configuración y programa el doble borrado", async () => {
    await ctx.useCase.handle(messageUpdate("/f2b", { messageId: 55 }));
    await flush();
    const sent = ctx.notifier.sent[0];
    expect(sent?.text).toBe("🛠️ <b>Configuración F2B</b>");
    expect(sent?.options?.replyMarkup).toEqual({
      inline_keyboard: [
        [
          { text: "📊 ¡Mostrar valores!", callback_data: "show_counter" },
          { text: "⚠️ ¡No tocar!", callback_data: "not_touch" },
        ],
      ],
    });
    expect(ctx.delays).toEqual([6000, 12000]);
    expect(ctx.notifier.deleted).toEqual([
      { chatId: "CHAT", messageId: 55 },
      { chatId: "CHAT", messageId: 1000 },
    ]);
  });

  it("/f2b también dispara con sufijo tipo /f2b@bot", async () => {
    await ctx.useCase.handle(messageUpdate("/f2b@bot"));
    expect(ctx.notifier.sent[0]?.text).toContain("Configuración F2B");
  });

  it("/chat_id envía los ids (sin borrado)", async () => {
    await ctx.useCase.handle(
      messageUpdate("/chat_id", { userId: 42, chatId: "CHAT", threadId: 7 }),
    );
    expect(ctx.notifier.sent[0]?.text).toBe(
      "👤 <b>Tu User ID:</b> <span class='tg-spoiler'>42</span>\n" +
        "💬 <b>Chat/Grupo ID:</b> <span class='tg-spoiler'>CHAT</span>" +
        "\n📂 <b>ID del Tema:</b> <span class='tg-spoiler'>7</span>\n" +
        "🔍 <b>¡Guárdalo de forma segura!</b> 🔒",
    );
    expect(ctx.notifier.deleted).toHaveLength(0);
  });

  it("/start y /help responden (mejora: el original no los enviaba)", async () => {
    await ctx.useCase.handle(messageUpdate("/start"));
    await ctx.useCase.handle(messageUpdate("/help"));
    expect(ctx.notifier.sent[0]?.text).toBe("Hola. Usa /chat_id o /f2b.");
    expect(ctx.notifier.sent[1]?.text).toContain("Comandos:");
  });

  it("texto desconocido no envía nada", async () => {
    await ctx.useCase.handle(messageUpdate("hola"));
    expect(ctx.notifier.sent).toHaveLength(0);
  });

  it("callback show_counter responde y muestra el contador", async () => {
    await ctx.useCase.handle(callbackUpdate("show_counter"));
    await flush();
    expect(ctx.notifier.answered).toEqual([{ callbackId: "cb-1" }]);
    expect(ctx.notifier.sent[0]?.text).toBe("<b>📊 CONTADOR DE BLOQUEOS</b>");
    expect(ctx.notifier.sent[0]?.options?.replyMarkup?.inline_keyboard[0]?.[0]?.text).toBe(
      "📈 Diarios: 4",
    );
  });

  it("callback not_touch responde y reinicia", async () => {
    await ctx.useCase.handle(callbackUpdate("not_touch"));
    expect(ctx.notifier.answered).toEqual([{ callbackId: "cb-1" }]);
    expect(ctx.counterStore.state).toEqual({
      daily: 0,
      permanent: 2,
      total: 14,
      last: "12:00:00",
    });
  });

  it("callback desconocido solo responde", async () => {
    await ctx.useCase.handle(callbackUpdate("noop"));
    expect(ctx.notifier.answered).toHaveLength(1);
    expect(ctx.notifier.sent).toHaveLength(0);
  });
});
