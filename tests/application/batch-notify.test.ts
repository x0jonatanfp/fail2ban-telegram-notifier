import { describe, expect, it, vi } from "vitest";
import { NotifyFail2banEventsUseCase } from "../../src/application/notify-fail2ban-events.ts";
import { getMessages } from "../../src/domain/services/message-format.ts";
import { createTestLogger, FakeNotifier, InMemoryCounterStore } from "../test/helpers.ts";

type Deps = ConstructorParameters<typeof NotifyFail2banEventsUseCase>[0];

const NOW = new Date(2026, 9, 10, 14, 23, 11);

function buildBatch(overrides: Partial<Deps> = {}) {
  const notifier = new FakeNotifier();
  const counterStore = new InMemoryCounterStore();
  const logger = createTestLogger();
  const timers: Array<{ callback: () => void; ms: number }> = [];
  const useCase = new NotifyFail2banEventsUseCase({
    notifier,
    counterStore,
    messages: getMessages("es"),
    logger,
    chatId: "CHAT",
    permanentJails: new Set(["recidive"]),
    ignoreJails: new Set(),
    ignoreIps: new Set(),
    suppressShutdownFlush: true,
    now: () => NOW,
    notifyMode: "batch",
    batchWindowSec: 3600,
    batchShowIps: false,
    batchMaxEvents: 0,
    instantJails: new Set(),
    notifyUnbans: "count",
    setTimer: (callback, ms) => {
      timers.push({ callback, ms });
      return { unref: () => undefined };
    },
    clearTimer: () => undefined,
    ...overrides,
  });
  return { notifier, counterStore, logger, useCase, timers };
}

const banLine = (ip: string, jail = "sshd") =>
  `2026-10-10 14:23:11,000 fail2ban.actions [1]: NOTICE [${jail}] Ban ${ip}`;
const unbanLine = (ip: string, jail = "sshd") =>
  `2026-10-10 14:23:11,000 fail2ban.actions [1]: NOTICE [${jail}] Unban ${ip}`;

describe("NotifyFail2banEventsUseCase (batch)", () => {
  it("encola y el flush envía un resumen de una sola línea", async () => {
    const ctx = buildBatch();
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.2.3.4") });
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.2.3.5") });
    expect(ctx.notifier.sent).toHaveLength(0);

    await ctx.useCase.flush();
    expect(ctx.notifier.sent).toHaveLength(1);
    expect(ctx.notifier.sent[0]?.text).toBe(
      "📊 Resumen 14:00–15:00 · 🔒 2 bloqueos (sshd 2)",
    );
    expect(ctx.notifier.sent[0]?.text).not.toContain("\n");
  });

  it("actualiza el contador UNA vez por lote y con todos los bans", async () => {
    const ctx = buildBatch();
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.1.1.1") });
    await ctx.useCase.handle({ kind: "line", raw: banLine("2.2.2.2", "recidive") });
    await ctx.useCase.handle({ kind: "line", raw: unbanLine("3.3.3.3") });
    await ctx.useCase.flush();

    expect(ctx.counterStore.saves).toHaveLength(1);
    expect(ctx.counterStore.state.daily).toBe(1);
    expect(ctx.counterStore.state.permanent).toBe(1);
  });

  it("ventana vacía no envía nada", async () => {
    const ctx = buildBatch();
    await ctx.useCase.flush();
    expect(ctx.notifier.sent).toHaveLength(0);
    expect(ctx.counterStore.saves).toHaveLength(0);
  });

  it("NOTIFY_INSTANT_JAILS salta el lote y no se recuenta", async () => {
    const ctx = buildBatch({ instantJails: new Set(["sshd"]) });
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.2.3.4", "sshd") });
    // Camino instantáneo: mensaje inmediato con el formato de siempre.
    expect(ctx.notifier.sent).toHaveLength(1);
    expect(ctx.notifier.sent[0]?.text).toContain("ha sido <b>bloqueada</b>");

    await ctx.useCase.handle({ kind: "line", raw: banLine("9.9.9.9", "apache") });
    await ctx.useCase.flush();
    expect(ctx.notifier.sent).toHaveLength(2);
    expect(ctx.notifier.sent[1]?.text).toBe(
      "📊 Resumen 14:00–15:00 · 🔒 1 bloqueo (apache 1)",
    );
    // El contador suma ambos (1 instantáneo + 1 del lote).
    expect(ctx.counterStore.state.daily).toBe(2);
  });

  it("BATCH_MAX_EVENTS envía antes de tiempo", async () => {
    const ctx = buildBatch({ batchMaxEvents: 2 });
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.1.1.1") });
    expect(ctx.notifier.sent).toHaveLength(0);
    await ctx.useCase.handle({ kind: "line", raw: banLine("2.2.2.2") });
    await vi.waitFor(() => {
      expect(ctx.notifier.sent).toHaveLength(1);
    });
    expect(ctx.notifier.sent[0]?.text).toContain("🔒 2 bloqueos");
  });

  it("los filtros se aplican antes de encolar", async () => {
    const ctx = buildBatch({
      ignoreJails: new Set(["sshd"]),
      ignoreIps: new Set(["9.9.9.9"]),
    });
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.2.3.4", "sshd") });
    await ctx.useCase.handle({ kind: "line", raw: banLine("9.9.9.9", "apache") });
    await ctx.useCase.flush();
    expect(ctx.notifier.sent).toHaveLength(0);
  });

  it("la supresión del flush de apagado se aplica antes de encolar", async () => {
    const ctx = buildBatch();
    await ctx.useCase.handle({ kind: "line", raw: "Stopping all jails" });
    await ctx.useCase.handle({ kind: "line", raw: unbanLine("1.2.3.4") });
    await ctx.useCase.flush();
    expect(ctx.notifier.sent).toHaveLength(0);
  });

  it("rotation sigue siendo instantáneo en modo batch", async () => {
    const ctx = buildBatch();
    await ctx.useCase.handle({ kind: "rotation", reason: "size" });
    expect(ctx.notifier.sent).toHaveLength(1);
    expect(ctx.notifier.sent[0]?.text).toContain("Rotación de log");
  });

  it("NOTIFY_UNBANS=off omite los unbans y solo-unbans no envía", async () => {
    const ctx = buildBatch({ notifyUnbans: "off" });
    await ctx.useCase.handle({ kind: "line", raw: unbanLine("1.2.3.4") });
    await ctx.useCase.handle({ kind: "line", raw: banLine("5.5.5.5") });
    await ctx.useCase.flush();
    expect(ctx.notifier.sent).toHaveLength(1);
    expect(ctx.notifier.sent[0]?.text).not.toContain("🌐");

    const only = buildBatch({ notifyUnbans: "off" });
    await only.useCase.handle({ kind: "line", raw: unbanLine("1.2.3.4") });
    await only.useCase.flush();
    expect(only.notifier.sent).toHaveLength(0);
  });

  it("si el envío falla NO actualiza el contador y reintenta en la siguiente ventana", async () => {
    const ctx = buildBatch();
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.2.3.4") });

    let calls = 0;
    const real = ctx.notifier.sendMessage.bind(ctx.notifier);
    ctx.notifier.sendMessage = async (...args) => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return real(...args);
    };

    await ctx.useCase.flush();
    expect(ctx.counterStore.saves).toHaveLength(0);
    expect(ctx.logger.messagesOf("error")).toContain(
      "Error enviando el resumen del lote; se reintentará.",
    );

    // Los eventos se conservan: el siguiente flush los envía.
    await ctx.useCase.flush();
    expect(ctx.notifier.sent).toHaveLength(1);
    expect(ctx.counterStore.saves).toHaveLength(1);
    expect(ctx.counterStore.state.daily).toBe(1);
  });

  it("programa el flush al fin de la ventana alineada y lo reprograma", async () => {
    const ctx = buildBatch();
    ctx.useCase.start();
    expect(ctx.timers).toHaveLength(1);
    // De 14:23:11 a 15:00 quedan 36m49s.
    expect(ctx.timers[0]?.ms).toBe((36 * 60 + 49) * 1000);

    await ctx.useCase.handle({ kind: "line", raw: banLine("1.2.3.4") });
    ctx.timers[0]?.callback();
    await vi.waitFor(() => {
      expect(ctx.notifier.sent).toHaveLength(1);
    });
    // Tras el disparo se reprograma la ventana siguiente.
    await vi.waitFor(() => {
      expect(ctx.timers.length).toBeGreaterThanOrEqual(2);
    });
    expect(ctx.notifier.sent[0]?.text).toContain("📊 Resumen 14:00–15:00");
    ctx.useCase.stop();
  });

  it("flush() sirve para vaciar al parar", async () => {
    const ctx = buildBatch();
    ctx.useCase.start();
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.2.3.4") });
    await ctx.useCase.flush();
    ctx.useCase.stop();
    expect(ctx.notifier.sent).toHaveLength(1);
  });

  it("pasa el threadId al resumen", async () => {
    const ctx = buildBatch({ threadId: 99 });
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.2.3.4") });
    await ctx.useCase.flush();
    expect(ctx.notifier.sent[0]?.options?.threadId).toBe(99);
  });
});
