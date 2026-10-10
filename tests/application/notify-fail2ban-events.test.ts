import { beforeEach, describe, expect, it } from "vitest";
import { NotifyFail2banEventsUseCase } from "../../src/application/notify-fail2ban-events.ts";
import { getMessages } from "../../src/domain/services/message-format.ts";
import {
  createTestLogger,
  FakeNotifier,
  InMemoryCounterStore,
} from "../test/helpers.ts";

const NOW = new Date(2026, 9, 10, 12, 34, 56); // 12:34:56 local

function build(overrides: Partial<ConstructorParameters<typeof NotifyFail2banEventsUseCase>[0]> = {}) {
  const notifier = new FakeNotifier();
  const counterStore = new InMemoryCounterStore();
  const logger = createTestLogger();
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
    ...overrides,
  });
  return { notifier, counterStore, logger, useCase };
}

const banLine = (ip: string, jail = "sshd") =>
  `2026-10-10 12:34:56,000 fail2ban.actions [1]: NOTICE [${jail}] Ban ${ip}`;
const unbanLine = (ip: string, jail = "sshd") =>
  `2026-10-10 12:34:56,000 fail2ban.actions [1]: NOTICE [${jail}] Unban ${ip}`;

describe("NotifyFail2banEventsUseCase", () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it("notifica un Ban normal y actualiza el contador (daily+1, last)", async () => {
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.2.3.4") });
    expect(ctx.notifier.sent).toHaveLength(1);
    expect(ctx.notifier.sent[0]?.text).toBe(
      '🔒 IP <span class="tg-spoiler">1.2.3.4</span> ha sido <b>bloqueada</b> por <b><i>sshd</i></b>.',
    );
    expect(ctx.counterStore.state).toEqual({
      daily: 1,
      permanent: 0,
      total: 0,
      last: "12:34:56",
    });
  });

  it("notifica un Ban de recidive como permanente", async () => {
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.2.3.4", "recidive") });
    expect(ctx.notifier.sent[0]?.text).toContain("permanentemente");
    expect(ctx.counterStore.state).toEqual({
      daily: 0,
      permanent: 1,
      total: 0,
      last: "12:34:56",
    });
  });

  it("notifica Unban sin tocar el contador", async () => {
    ctx.counterStore.state = { daily: 2, permanent: 1, total: 5, last: "09:00:00" };
    await ctx.useCase.handle({ kind: "line", raw: unbanLine("1.2.3.4") });
    expect(ctx.notifier.sent[0]?.text).toContain("desbloqueada");
    expect(ctx.counterStore.state).toEqual({
      daily: 2,
      permanent: 1,
      total: 5,
      last: "09:00:00",
    });
  });

  it("ignora acciones distintas de Ban/Unban (Found)", async () => {
    await ctx.useCase.handle({
      kind: "line",
      raw: "2026-10-10 12:34:56,000 fail2ban.actions [1]: NOTICE [sshd] Found 1.2.3.4",
    });
    expect(ctx.notifier.sent).toHaveLength(0);
  });

  it("suprime los Unban del flush tras un marcador de apagado", async () => {
    await ctx.useCase.handle({
      kind: "line",
      raw: "2026-10-10 12:34:56,000 fail2ban.jail [1]: INFO Stopping all jails",
    });
    await ctx.useCase.handle({ kind: "line", raw: unbanLine("1.2.3.4") });
    expect(ctx.notifier.sent).toHaveLength(0);
  });

  it("un Ban real reactiva y vuelve a notificar", async () => {
    await ctx.useCase.handle({ kind: "line", raw: "Stopping all jails" });
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.2.3.4") });
    expect(ctx.notifier.sent).toHaveLength(1);
    // Tras el Ban, un Unban ya no se suprime.
    await ctx.useCase.handle({ kind: "line", raw: unbanLine("1.2.3.4") });
    expect(ctx.notifier.sent).toHaveLength(2);
  });

  it("'Starting Fail2ban' reinicia el modo normal", async () => {
    await ctx.useCase.handle({ kind: "line", raw: "Stopping all jails" });
    await ctx.useCase.handle({ kind: "line", raw: "2026-... Starting Fail2ban" });
    await ctx.useCase.handle({ kind: "line", raw: unbanLine("1.2.3.4") });
    expect(ctx.notifier.sent).toHaveLength(1);
  });

  it("con suppressShutdownFlush=false no suprime nada", async () => {
    const custom = build({ suppressShutdownFlush: false });
    await custom.useCase.handle({ kind: "line", raw: "Stopping all jails" });
    await custom.useCase.handle({ kind: "line", raw: unbanLine("1.2.3.4") });
    expect(custom.notifier.sent).toHaveLength(1);
  });

  it("respeta F2B_IGNORE_JAILS / F2B_IGNORE_IPS", async () => {
    const custom = build({
      ignoreJails: new Set(["sshd"]),
      ignoreIps: new Set(["9.9.9.9"]),
    });
    await custom.useCase.handle({ kind: "line", raw: banLine("1.2.3.4", "sshd") });
    await custom.useCase.handle({ kind: "line", raw: banLine("9.9.9.9", "apache") });
    expect(custom.notifier.sent).toHaveLength(0);
  });

  it("un Ban ignorado igualmente reactiva la supresión", async () => {
    const custom = build({ ignoreJails: new Set(["sshd"]) });
    await custom.useCase.handle({ kind: "line", raw: "Stopping all jails" });
    await custom.useCase.handle({ kind: "line", raw: banLine("1.2.3.4", "sshd") });
    await custom.useCase.handle({ kind: "line", raw: unbanLine("1.2.3.4", "apache") });
    // El Unban de apache no se suprime porque el Ban (aunque ignorado) reactivó.
    expect(custom.notifier.sent).toHaveLength(1);
  });

  it("avisa de la rotación de log", async () => {
    await ctx.useCase.handle({ kind: "rotation", reason: "size" });
    await ctx.useCase.handle({ kind: "rotation", reason: "inode" });
    expect(ctx.notifier.sent[0]?.text).toContain("Rotación de log detectada");
    expect(ctx.notifier.sent[1]?.text).toContain("Reemplazo de log detectado");
  });

  it("si el envío falla, NO actualiza el contador", async () => {
    ctx.notifier.sendMessage = async () => {
      throw new Error("boom");
    };
    await ctx.useCase.handle({ kind: "line", raw: banLine("1.2.3.4") });
    expect(ctx.counterStore.saves).toHaveLength(0);
    expect(ctx.logger.messagesOf("error")).toContain("Error enviando mensaje de ban.");
  });

  it("pasa el threadId al notifier", async () => {
    const custom = build({ threadId: 99 });
    await custom.useCase.handle({ kind: "line", raw: banLine("1.2.3.4") });
    expect(custom.notifier.sent[0]?.options?.threadId).toBe(99);
  });
});
