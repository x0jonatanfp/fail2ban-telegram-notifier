import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/infrastructure/config/env.ts";

const base = { TRANSPORT: "gateway", TELEGRAM_CHAT_ID: "1" } as const;

describe("loadConfig (batch)", () => {
  it("sin variables nuevas el config sigue siendo instant", () => {
    const config = loadConfig({ ...base });
    expect(config.notifyMode).toBe("instant");
    expect(config.batchWindowSec).toBe(3600);
    expect(config.batchShowIps).toBe(false);
    expect(config.batchMaxEvents).toBe(0);
    expect(config.instantJails).toEqual([]);
    expect(config.notifyUnbans).toBe("count");
  });

  it("parsea las variables batch", () => {
    const config = loadConfig({
      ...base,
      NOTIFY_MODE: "batch",
      BATCH_WINDOW_SEC: "900",
      BATCH_SHOW_IPS: "true",
      BATCH_MAX_EVENTS: "10",
      NOTIFY_INSTANT_JAILS: "sshd, recidive",
      NOTIFY_UNBANS: "list",
    });
    expect(config.notifyMode).toBe("batch");
    expect(config.batchWindowSec).toBe(900);
    expect(config.batchShowIps).toBe(true);
    expect(config.batchMaxEvents).toBe(10);
    expect(config.instantJails).toEqual(["sshd", "recidive"]);
    expect(config.notifyUnbans).toBe("list");
  });

  it("NOTIFY_MODE inválido falla con error claro", () => {
    expect(() => loadConfig({ ...base, NOTIFY_MODE: "foo" })).toThrowError(ConfigError);
    try {
      loadConfig({ ...base, NOTIFY_MODE: "foo" });
    } catch (error) {
      expect((error as Error).message).toContain("NOTIFY_MODE debe ser uno de");
    }
  });

  it("BATCH_WINDOW_SEC debe ser entero > 0 y divisor de 86400", () => {
    for (const value of ["0", "-5", "7", "1000", "86401"]) {
      try {
        loadConfig({ ...base, BATCH_WINDOW_SEC: value });
        throw new Error(`no debería aceptar ${value}`);
      } catch (error) {
        expect((error as Error).message).toMatch(/BATCH_WINDOW_SEC/);
      }
    }
    // Divisores válidos representativos.
    for (const value of ["60", "900", "3600", "86400"]) {
      expect(loadConfig({ ...base, BATCH_WINDOW_SEC: value }).batchWindowSec).toBe(Number(value));
    }
  });

  it("NOTIFY_UNBANS inválido falla", () => {
    expect(() => loadConfig({ ...base, NOTIFY_UNBANS: "x" })).toThrowError(/NOTIFY_UNBANS/);
  });

  it("BATCH_MAX_EVENTS negativo falla", () => {
    expect(() => loadConfig({ ...base, BATCH_MAX_EVENTS: "-1" })).toThrowError(/BATCH_MAX_EVENTS/);
  });
});
