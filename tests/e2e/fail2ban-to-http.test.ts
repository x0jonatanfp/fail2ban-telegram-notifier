import { afterEach, describe, expect, it, vi } from "vitest";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { TailLogSource } from "../../src/infrastructure/fail2ban/tail-log-source.ts";
import { DirectNotifier } from "../../src/infrastructure/telegram/direct/direct-notifier.ts";
import { GatewayNotifier } from "../../src/infrastructure/telegram/gateway/gateway-notifier.ts";
import { FileCounterStore } from "../../src/infrastructure/persistence/file-counter-store.ts";
import { NotifyFail2banEventsUseCase } from "../../src/application/notify-fail2ban-events.ts";
import { getMessages } from "../../src/domain/services/message-format.ts";
import type { NotifierPort } from "../../src/domain/ports/notifier.ts";
import {
  createTestLogger,
  jsonResponse,
  makeTempDir,
  removeDir,
  startFakeServer,
  waitFor,
  type FakeServer,
} from "../test/helpers.ts";

// PRUEBA FUNCIONAL DE EXTREMO A EXTREMO (local):
//   fichero de log temporal → TailLogSource real → NotifyFail2banEventsUseCase →
//   NotifierPort real (direct o gateway) → servidor HTTP falso en 127.0.0.1.
// Nunca se contacta con Telegram real.

const dirs: string[] = [];
const servers: FakeServer[] = [];
const sources: TailLogSource[] = [];
afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.stop()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(dirs.splice(0).map((dir) => removeDir(dir)));
});

const fastSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const banLine = (ip: string, jail = "sshd") =>
  `2026-10-10 12:34:56,000 fail2ban.actions [1]: NOTICE [${jail}] Ban ${ip}`;

async function scenario(pick: (server: FakeServer) => NotifierPort) {
  const dir = await makeTempDir();
  dirs.push(dir);
  const logFile = join(dir, "fail2ban.log");
  await writeFile(logFile, "", "utf8");

  const server = await startFakeServer((_request, _body, response: ServerResponse) => {
    jsonResponse(response, 200, { ok: true, result: { chatId: 1, messageId: 999 } });
  });
  servers.push(server);

  const notifier = pick(server);
  const counterStore = new FileCounterStore(join(dir, "counter.json"), createTestLogger());
  const useCase = new NotifyFail2banEventsUseCase({
    notifier,
    counterStore,
    messages: getMessages("es"),
    logger: createTestLogger(),
    chatId: "CHAT",
    permanentJails: new Set(["recidive"]),
    ignoreJails: new Set(),
    ignoreIps: new Set(),
    suppressShutdownFlush: true,
    now: () => new Date(2026, 9, 10, 12, 34, 56),
  });

  const source = new TailLogSource({
    filePath: logFile,
    pollIntervalMs: 10,
    logger: createTestLogger(),
    sleep: fastSleep,
  });
  sources.push(source);
  await source.start((event) => useCase.handle(event));
  await sleep(30);

  // 1) Ban real → debe salir un mensaje.
  await appendFile(logFile, `${banLine("203.0.113.7")}\n`, "utf8");
  await waitFor(() => server.requests.length >= 1);

  // 2) Apagado de fail2ban + Unban del flush → NO debe salir mensaje.
  await appendFile(
    logFile,
    "2026-10-10 12:40:00,000 fail2ban.jail [1]: INFO Stopping all jails\n",
    "utf8",
  );
  await appendFile(logFile, `${banLine("203.0.113.7").replace("Ban", "Unban")}\n`, "utf8");
  await sleep(60);
  const afterFlush = server.requests.length;

  // 3) Un Ban nuevo reactiva los avisos.
  await appendFile(logFile, `${banLine("198.51.100.9", "recidive")}\n`, "utf8");
  await waitFor(() => server.requests.length >= afterFlush + 1);

  return { server, counterStore, afterFlush };
}

describe("e2e: fail2ban → adaptador → servidor HTTP local", () => {
  it("TRANSPORT=direct: el mensaje sale por la Bot API falsa", async () => {
    const { server, counterStore, afterFlush } = await scenario(
      (fake) =>
        new DirectNotifier({ token: "TOKEN", apiBaseUrl: fake.url, parseMode: "HTML" }),
    );

    // Salida REAL capturada por el receptor local.
    console.log("[e2e direct] peticiones recibidas:", JSON.stringify(server.requests, null, 2));

    const sendRequests = server.requests.filter((r) => r.url === "/botTOKEN/sendMessage");
    expect(sendRequests).toHaveLength(2); // ban + ban recidive (el unban se suprimió)
    expect(server.requests.length).toBe(afterFlush + 1);
    expect((sendRequests[0]?.body as { text: string }).text).toBe(
      '🔒 IP <span class="tg-spoiler">203.0.113.7</span> ha sido <b>bloqueada</b> por <b><i>sshd</i></b>.',
    );
    expect((sendRequests[1]?.body as { text: string }).text).toContain("permanentemente");
    // El contador se actualiza DESPUÉS de enviar: esperamos a que persista.
    await vi.waitFor(async () => {
      expect(await counterStore.load()).toMatchObject({ daily: 1, permanent: 1 });
    });
  });

  it("TRANSPORT=gateway: el mensaje sale por /api/send del gateway falso", async () => {
    const { server, counterStore, afterFlush } = await scenario(
      (fake) => new GatewayNotifier({ gatewayUrl: fake.url, parseMode: "HTML" }),
    );

    console.log("[e2e gateway] peticiones recibidas:", JSON.stringify(server.requests, null, 2));

    const sendRequests = server.requests.filter((r) => r.url === "/api/send");
    expect(sendRequests).toHaveLength(2);
    expect(server.requests.length).toBe(afterFlush + 1);
    expect(sendRequests[0]?.body).toMatchObject({
      chat_id: "CHAT",
      parse_mode: "HTML",
    });
    await vi.waitFor(async () => {
      expect(await counterStore.load()).toMatchObject({ daily: 1, permanent: 1 });
    });
  });
});
