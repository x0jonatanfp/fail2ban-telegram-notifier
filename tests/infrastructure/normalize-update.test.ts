import { describe, expect, it } from "vitest";
import { normalizeUpdate } from "../../src/infrastructure/telegram/normalize-update.ts";

describe("normalizeUpdate", () => {
  it("normaliza un mensaje", () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 10,
        text: "/f2b",
        message_thread_id: 7,
        chat: { id: -100123 },
        from: { id: 42 },
      },
    };
    expect(normalizeUpdate(update)).toEqual({
      kind: "message",
      chatId: "-100123",
      userId: 42,
      messageId: 10,
      threadId: 7,
      text: "/f2b",
    });
  });

  it("normaliza un callback_query", () => {
    const update = {
      callback_query: {
        id: "cb-9",
        data: "show_counter",
        from: { id: 42 },
        message: { message_id: 11, chat: { id: -100123 } },
      },
    };
    expect(normalizeUpdate(update)).toEqual({
      kind: "callback",
      chatId: "-100123",
      userId: 42,
      messageId: 11,
      callbackId: "cb-9",
      callbackData: "show_counter",
    });
  });

  it("devuelve null para updates irrelevantes o malformados", () => {
    expect(normalizeUpdate(null)).toBeNull();
    expect(normalizeUpdate("texto")).toBeNull();
    expect(normalizeUpdate({ update_id: 1 })).toBeNull();
    expect(normalizeUpdate({ message: { text: "sin chat" } })).toBeNull();
  });
});
