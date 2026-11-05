import { describe, expect, it, vi } from "vitest";
import { DailyResetScheduler, nextMidnight } from "../../src/application/daily-reset.ts";
import { ResetCounterUseCase } from "../../src/application/reset-counter.ts";
import { getMessages } from "../../src/domain/services/message-format.ts";
import type { NotifierPort } from "../../src/domain/ports/notifier.ts";
import { createTestLogger, FakeNotifier, InMemoryCounterStore } from "../test/helpers.ts";

describe("nextMidnight", () => {
  it("devuelve la próxima medianoche local", () => {
    const from = new Date(2026, 9, 10, 13, 20, 30);
    expect(nextMidnight(from).getTime()).toBe(new Date(2026, 9, 11, 0, 0, 0).getTime());
  });

  it("en medianoche exacta salta al día siguiente (estricto)", () => {
    const from = new Date(2026, 9, 10, 0, 0, 0);
    expect(nextMidnight(from).getTime()).toBe(new Date(2026, 9, 11, 0, 0, 0).getTime());
  });
});

describe("DailyResetScheduler", () => {
  it("programa, ejecuta el reinicio y se reprograma", async () => {
    const notifier = new FakeNotifier();
    const counterStore = new InMemoryCounterStore({
      daily: 5,
      permanent: 2,
      total: 10,
      last: "08:00:00",
    });
    const resetCounter = new ResetCounterUseCase({
      notifier,
      counterStore,
      messages: getMessages("es"),
      logger: createTestLogger(),
      chatId: "CHAT",
      now: () => new Date(2026, 9, 11, 0, 0, 0),
    });

    const scheduled: Array<{ callback: () => void; ms: number }> = [];
    const cleared: unknown[] = [];
    const now = () => new Date(2026, 9, 10, 23, 0, 0);
    const scheduler = new DailyResetScheduler({
      resetCounter,
      logger: createTestLogger(),
      now,
      setTimer: (callback, ms) => {
        scheduled.push({ callback, ms });
        return { unref: () => undefined };
      },
      clearTimer: (handle) => {
        cleared.push(handle);
      },
    });

    scheduler.start();
    expect(scheduled).toHaveLength(1);
    // De 23:00 a 00:00 hay una hora.
    expect(scheduled[0]?.ms).toBe(60 * 60 * 1000);

    scheduled[0]?.callback();
    await vi.waitFor(() => {
      expect(counterStore.saves).toHaveLength(1);
    });
    expect(counterStore.state).toEqual({
      daily: 0,
      permanent: 2,
      total: 15,
      last: "00:00:00",
    });
    // Se reprograma tras ejecutar.
    expect(scheduled).toHaveLength(2);

    scheduler.stop();
    expect(cleared).toHaveLength(1);
  });

  it("si el reinicio falla, registra el error y se reprograma", async () => {
    const failingNotifier: NotifierPort = {
      sendMessage: async () => {
        throw new Error("boom");
      },
      deleteMessage: async () => undefined,
      answerCallback: async () => undefined,
      editReplyMarkup: async () => undefined,
    };
    const resetCounter = new ResetCounterUseCase({
      notifier: failingNotifier,
      counterStore: new InMemoryCounterStore(),
      messages: getMessages("es"),
      logger: createTestLogger(),
      chatId: "CHAT",
      now: () => new Date(2026, 9, 11, 0, 0, 0),
    });

    const logger = createTestLogger();
    const scheduled: Array<() => void> = [];
    const scheduler = new DailyResetScheduler({
      resetCounter,
      logger,
      now: () => new Date(2026, 9, 10, 23, 0, 0),
      setTimer: (callback) => {
        scheduled.push(callback);
        return { unref: () => undefined };
      },
    });

    scheduler.start();
    scheduled[0]?.();

    await vi.waitFor(() => {
      expect(logger.messagesOf("error")).toContain("Error en el reinicio diario.");
    });
    // Aun con error, el `finally` reprograma.
    expect(scheduled).toHaveLength(2);

    scheduler.stop();
  });

  it("beforeReset se espera ANTES del reinicio (orden flush → contador → reset)", async () => {
    const order: string[] = [];
    const notifier = new FakeNotifier();
    const counterStore = new InMemoryCounterStore({
      daily: 5,
      permanent: 0,
      total: 10,
      last: "08:00:00",
    });
    const resetCounter = new ResetCounterUseCase({
      notifier,
      counterStore,
      messages: getMessages("es"),
      logger: createTestLogger(),
      chatId: "CHAT",
      now: () => new Date(2026, 9, 11, 0, 0, 0),
    });
    const originalExecute = resetCounter.execute.bind(resetCounter);
    resetCounter.execute = async (...args) => {
      order.push("reset");
      return originalExecute(...args);
    };

    const scheduled: Array<() => void> = [];
    const scheduler = new DailyResetScheduler({
      resetCounter,
      logger: createTestLogger(),
      now: () => new Date(2026, 9, 10, 23, 0, 0),
      beforeReset: async () => {
        order.push("flush");
      },
      setTimer: (callback) => {
        scheduled.push(callback);
        return { unref: () => undefined };
      },
    });

    scheduler.start();
    scheduled[0]?.();
    await vi.waitFor(() => {
      expect(counterStore.saves).toHaveLength(1);
    });
    expect(order).toEqual(["flush", "reset"]);
    scheduler.stop();
  });

  it("si el gancho falla, se registra y el reinicio se ejecuta igualmente", async () => {
    const logger = createTestLogger();
    const counterStore = new InMemoryCounterStore({
      daily: 5,
      permanent: 0,
      total: 10,
      last: "08:00:00",
    });
    const resetCounter = new ResetCounterUseCase({
      notifier: new FakeNotifier(),
      counterStore,
      messages: getMessages("es"),
      logger: createTestLogger(),
      chatId: "CHAT",
      now: () => new Date(2026, 9, 11, 0, 0, 0),
    });
    const scheduled: Array<() => void> = [];
    const scheduler = new DailyResetScheduler({
      resetCounter,
      logger,
      now: () => new Date(2026, 9, 10, 23, 0, 0),
      beforeReset: async () => {
        throw new Error("flush roto");
      },
      setTimer: (callback) => {
        scheduled.push(callback);
        return { unref: () => undefined };
      },
    });

    scheduler.start();
    scheduled[0]?.();
    await vi.waitFor(() => {
      expect(counterStore.saves).toHaveLength(1);
    });
    expect(logger.messagesOf("error")).toContain(
      "Error en el gancho previo al reinicio diario.",
    );
    scheduler.stop();
  });

  it("stop sin nada programado no falla", () => {
    const resetCounter = new ResetCounterUseCase({
      notifier: new FakeNotifier(),
      counterStore: new InMemoryCounterStore(),
      messages: getMessages("es"),
      logger: createTestLogger(),
      chatId: "CHAT",
      now: () => new Date(),
    });
    const scheduler = new DailyResetScheduler({
      resetCounter,
      logger: createTestLogger(),
      now: () => new Date(),
    });

    expect(() => scheduler.stop()).not.toThrow();
  });

  it("usa temporizadores reales por defecto y stop los limpia", () => {
    const resetCounter = new ResetCounterUseCase({
      notifier: new FakeNotifier(),
      counterStore: new InMemoryCounterStore(),
      messages: getMessages("es"),
      logger: createTestLogger(),
      chatId: "CHAT",
      now: () => new Date(),
    });
    const scheduler = new DailyResetScheduler({
      resetCounter,
      logger: createTestLogger(),
      now: () => new Date(2026, 9, 10, 12, 0, 0),
    });

    scheduler.start(); // setTimer por defecto (setTimeout real, con unref)
    expect(() => scheduler.stop()).not.toThrow(); // clearTimer por defecto
  });
});
