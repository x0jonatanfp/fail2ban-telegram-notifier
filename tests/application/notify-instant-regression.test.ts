// Regresión `instant`: sin `NOTIFY_MODE` el flujo es el de siempre (un
// mensaje por evento), sin batch ni resumen.
import { describe, expect, it } from "vitest";
import { NotifyFail2banEventsUseCase } from "../../src/application/notify-fail2ban-events.ts";
import { getMessages } from "../../src/domain/services/message-format.ts";
import { createTestLogger, FakeNotifier, InMemoryCounterStore } from "../test/helpers.ts";

describe("NotifyFail2banEventsUseCase (regresión instant por defecto)", () => {
  it("sin NOTIFY_MODE envía un mensaje por evento y nunca un resumen", async () => {
    const notifier = new FakeNotifier();
    const counterStore = new InMemoryCounterStore();
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
      // Sin `notifyMode`: debe comportarse como `instant`.
    });

    await useCase.handle({
      kind: "line",
      raw: "2026-10-10 12:34:56,000 fail2ban.actions [1]: NOTICE [sshd] Ban 1.2.3.4",
    });
    await useCase.handle({
      kind: "line",
      raw: "2026-10-10 12:34:56,000 fail2ban.actions [1]: NOTICE [sshd] Unban 1.2.3.4",
    });

    expect(notifier.sent).toHaveLength(2);
    expect(notifier.sent[0]?.text).toContain("ha sido <b>bloqueada</b>");
    expect(notifier.sent[1]?.text).toContain("ha sido <b>desbloqueada</b>");
    for (const sent of notifier.sent) {
      expect(sent.text).not.toContain("Resumen");
    }

    // `flush()` en instant es un no-op.
    await useCase.flush();
    expect(notifier.sent).toHaveLength(2);
  });
});
