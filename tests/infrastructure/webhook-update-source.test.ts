import { afterEach, describe, expect, it } from "vitest";
import { WebhookUpdateSource } from "../../src/infrastructure/telegram/gateway/webhook-update-source.ts";
import type { IncomingUpdate } from "../../src/domain/entities/incoming-update.ts";
import {
  createTestLogger,
  jsonResponse,
  startFakeServer,
  waitFor,
  type FakeServer,
} from "../test/helpers.ts";

const servers: FakeServer[] = [];
const sources: WebhookUpdateSource[] = [];
afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.stop()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("WebhookUpdateSource", () => {
  it("registra los handlers en el gateway y recibe updates", async () => {
    const gateway = await startFakeServer((_request, _body, response) =>
      jsonResponse(response, 200, { ok: true }),
    );
    servers.push(gateway);

    const received: IncomingUpdate[] = [];
    const source = new WebhookUpdateSource({
      host: "127.0.0.1",
      port: 0,
      gatewayUrl: gateway.url,
      commands: ["/f2b", "show_counter"],
      reregisterMs: 0,
      logger: createTestLogger(),
    });
    sources.push(source);

    await source.start(async (update) => {
      received.push(update);
    });

    // Registro de los dos handlers.
    const registered = gateway.requests.map((r) => r.body as { command: string; webhook: string });
    expect(registered.map((r) => r.command)).toEqual(["/f2b", "show_counter"]);
    expect(registered[0]?.webhook).toBe(`http://127.0.0.1:${source.port}/tg-update`);

    // Recepción de un update crudo.
    const response = await fetch(source.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 1,
        message: { message_id: 2, text: "/f2b", chat: { id: 9 }, from: { id: 3 } },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(received[0]).toMatchObject({ kind: "message", chatId: "9", text: "/f2b" });
  });

  it("re-registra periódicamente si reregisterMs > 0", async () => {
    const gateway = await startFakeServer((_request, _body, response) =>
      jsonResponse(response, 200, { ok: true }),
    );
    servers.push(gateway);

    const source = new WebhookUpdateSource({
      host: "127.0.0.1",
      port: 0,
      gatewayUrl: gateway.url,
      commands: ["/f2b"],
      reregisterMs: 20,
      logger: createTestLogger(),
    });
    sources.push(source);

    await source.start(async () => undefined);
    await waitFor(() => gateway.requests.length >= 2, 2000);
    expect(gateway.requests.length).toBeGreaterThanOrEqual(2);
  });

  it("responde 404 en rutas o métodos no soportados", async () => {
    const source = new WebhookUpdateSource({
      host: "127.0.0.1",
      port: 0,
      gatewayUrl: "http://127.0.0.1:1",
      commands: [],
      reregisterMs: 0,
      logger: createTestLogger(),
    });
    sources.push(source);
    await source.start(async () => undefined);

    const response = await fetch(`http://127.0.0.1:${source.port}/otra`);
    expect(response.status).toBe(404);
  });
});
