import { afterEach, describe, expect, it } from "vitest";
import { PollerUpdateSource } from "../../src/infrastructure/telegram/direct/poller-update-source.ts";
import type { IncomingUpdate } from "../../src/domain/entities/incoming-update.ts";
import {
  createTestLogger,
  jsonResponse,
  startFakeServer,
  waitFor,
  type FakeServer,
} from "../test/helpers.ts";

const servers: FakeServer[] = [];
const sources: PollerUpdateSource[] = [];
afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.stop()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("PollerUpdateSource", () => {
  it("hace long-polling, normaliza el update y avanza el offset", async () => {
    let call = 0;
    const server = await startFakeServer((_request, _body, response) => {
      const current = call;
      call += 1;
      if (current === 0) {
        jsonResponse(response, 200, {
          ok: true,
          result: [
            {
              update_id: 5,
              message: {
                message_id: 1,
                text: "hola",
                chat: { id: 100 },
                from: { id: 2 },
              },
            },
          ],
        });
      } else {
        setTimeout(() => jsonResponse(response, 200, { ok: true, result: [] }), 20);
      }
    });
    servers.push(server);

    const received: IncomingUpdate[] = [];
    const source = new PollerUpdateSource({
      token: "T",
      apiBaseUrl: server.url,
      pollTimeoutSec: 1,
      logger: createTestLogger(),
    });
    sources.push(source);

    await source.start(async (update) => {
      received.push(update);
    });
    await waitFor(() => received.length > 0);
    await waitFor(() => server.requests.length >= 2);

    expect(received[0]).toMatchObject({ kind: "message", chatId: "100", text: "hola" });
    expect(server.requests[1]?.url).toContain("offset=6");
  });

  it("reintenta con backoff ante error HTTP", async () => {
    let call = 0;
    const server = await startFakeServer((_request, _body, response) => {
      const current = call;
      call += 1;
      if (current === 0) {
        jsonResponse(response, 500, { ok: false });
      } else {
        setTimeout(() => jsonResponse(response, 200, { ok: true, result: [] }), 20);
      }
    });
    servers.push(server);

    const logger = createTestLogger();
    const source = new PollerUpdateSource({
      token: "T",
      apiBaseUrl: server.url,
      pollTimeoutSec: 1,
      logger,
      backoffMs: 10,
    });
    sources.push(source);

    await source.start(async () => undefined);
    await waitFor(() => logger.messagesOf("warn").length > 0);
    expect(logger.messagesOf("warn")[0]).toContain("Error en getUpdates");
  });
});
