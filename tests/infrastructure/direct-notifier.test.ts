import { afterEach, describe, expect, it } from "vitest";
import type { ServerResponse } from "node:http";
import { DirectNotifier } from "../../src/infrastructure/telegram/direct/direct-notifier.ts";
import { jsonResponse, startFakeServer, type FakeServer } from "../test/helpers.ts";

const servers: FakeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function withServer(
  responder: (url: string | undefined, response: ServerResponse) => void,
): Promise<FakeServer> {
  const server = await startFakeServer((request, _body, response) => {
    responder(request.url, response);
  });
  servers.push(server);
  return server;
}

describe("DirectNotifier", () => {
  it("envía sendMessage con parse_mode y message_thread_id", async () => {
    const server = await withServer((_url, response) =>
      jsonResponse(response, 200, { ok: true, result: { message_id: 777 } }),
    );
    const notifier = new DirectNotifier({
      token: "TOKEN",
      apiBaseUrl: server.url,
      parseMode: "HTML",
    });

    const result = await notifier.sendMessage("CHAT", "hola", {
      replyMarkup: { inline_keyboard: [] },
      threadId: 5,
    });

    expect(result).toEqual({ messageId: 777 });
    const request = server.requests[0];
    expect(request?.url).toBe("/botTOKEN/sendMessage");
    expect(request?.body).toEqual({
      chat_id: "CHAT",
      text: "hola",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
      message_thread_id: 5,
    });
  });

  it("omite message_thread_id si no se indica", async () => {
    const server = await withServer((_url, response) =>
      jsonResponse(response, 200, { ok: true, result: { message_id: 1 } }),
    );
    const notifier = new DirectNotifier({ token: "T", apiBaseUrl: server.url, parseMode: "HTML" });
    await notifier.sendMessage("CHAT", "hola");
    expect(server.requests[0]?.body).toEqual({
      chat_id: "CHAT",
      text: "hola",
      parse_mode: "HTML",
    });
  });

  it("lanza si Telegram responde ok:false", async () => {
    const server = await withServer((_url, response) =>
      jsonResponse(response, 200, { ok: false, description: "chat not found" }),
    );
    const notifier = new DirectNotifier({ token: "T", apiBaseUrl: server.url, parseMode: "HTML" });
    await expect(notifier.sendMessage("CHAT", "hola")).rejects.toThrowError(/chat not found/);
  });

  it("lanza si Telegram responde 429", async () => {
    const server = await withServer((_url, response) =>
      jsonResponse(response, 429, { ok: false, description: "Too Many Requests" }),
    );
    const notifier = new DirectNotifier({ token: "T", apiBaseUrl: server.url, parseMode: "HTML" });
    await expect(notifier.sendMessage("CHAT", "hola")).rejects.toThrowError(/Too Many Requests/);
  });

  it("deleteMessage, answerCallback y editReplyMarkup llaman al método correcto", async () => {
    const server = await withServer((_url, response) =>
      jsonResponse(response, 200, { ok: true, result: true }),
    );
    const notifier = new DirectNotifier({ token: "T", apiBaseUrl: server.url, parseMode: "HTML" });

    await notifier.deleteMessage("CHAT", 10);
    await notifier.answerCallback("cb", "ok");
    await notifier.editReplyMarkup("CHAT", 10, { inline_keyboard: [] });

    expect(server.requests.map((r) => r.url)).toEqual([
      "/botT/deleteMessage",
      "/botT/answerCallbackQuery",
      "/botT/editMessageReplyMarkup",
    ]);
    expect(server.requests[1]?.body).toEqual({ callback_query_id: "cb", text: "ok" });
  });
});
