import { afterEach, describe, expect, it } from "vitest";
import type { ServerResponse } from "node:http";
import { GatewayNotifier } from "../../src/infrastructure/telegram/gateway/gateway-notifier.ts";
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

describe("GatewayNotifier (contrato verificado del tg-gateway)", () => {
  it("/api/send devuelve el messageId y NO envía message_thread_id", async () => {
    const server = await withServer((_url, response) =>
      jsonResponse(response, 200, { ok: true, result: { chatId: 1, messageId: 42 } }),
    );
    const notifier = new GatewayNotifier({ gatewayUrl: server.url, parseMode: "HTML" });

    const result = await notifier.sendMessage("CHAT", "hola", {
      replyMarkup: { inline_keyboard: [] },
      threadId: 5, // el gateway lo ignora: no debe aparecer en el body
    });

    expect(result).toEqual({ messageId: 42 });
    const request = server.requests[0];
    expect(request?.url).toBe("/api/send");
    expect(request?.body).toEqual({
      chat_id: "CHAT",
      text: "hola",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    });
    expect(request?.body).not.toHaveProperty("message_thread_id");
  });

  it("lanza con 502 {ok:false} (Telegram rechazó el envío)", async () => {
    const server = await withServer((_url, response) =>
      jsonResponse(response, 502, { ok: false, error: "Telegram rechazó el envío" }),
    );
    const notifier = new GatewayNotifier({ gatewayUrl: server.url, parseMode: "HTML" });
    await expect(notifier.sendMessage("CHAT", "hola")).rejects.toThrowError(/502|rechazó/);
  });

  it("lanza con 500 {ok:false}", async () => {
    const server = await withServer((_url, response) =>
      jsonResponse(response, 500, { ok: false, error: "boom" }),
    );
    const notifier = new GatewayNotifier({ gatewayUrl: server.url, parseMode: "HTML" });
    await expect(notifier.sendMessage("CHAT", "hola")).rejects.toThrowError(/boom/);
  });

  it("deleteMessage, answerCallback y editReplyMarkup usan las rutas y claves correctas", async () => {
    const server = await withServer((_url, response) => jsonResponse(response, 200, { ok: true }));
    const notifier = new GatewayNotifier({ gatewayUrl: server.url, parseMode: "HTML" });

    await notifier.deleteMessage("CHAT", 10);
    await notifier.answerCallback("cb", "");
    await notifier.editReplyMarkup("CHAT", 10, { inline_keyboard: [] });

    expect(server.requests.map((r) => r.url)).toEqual([
      "/api/delete-message",
      "/api/answer-callback",
      "/api/edit-reply-markup",
    ]);
    expect(server.requests[0]?.body).toEqual({ chat_id: "CHAT", message_id: 10 });
    expect(server.requests[1]?.body).toEqual({ callback_id: "cb", text: "" });
    expect(server.requests[2]?.body).toEqual({
      chat_id: "CHAT",
      message_id: 10,
      reply_markup: { inline_keyboard: [] },
    });
  });
});
