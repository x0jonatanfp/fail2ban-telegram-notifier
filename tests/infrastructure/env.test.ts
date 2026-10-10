import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/infrastructure/config/env.ts";

describe("loadConfig", () => {
  it("aplica los valores por defecto en modo direct", () => {
    const config = loadConfig({
      TRANSPORT: "direct",
      TELEGRAM_CHAT_ID: "-100123",
      TELEGRAM_BOT_TOKEN: "token",
    });
    expect(config.transport).toBe("direct");
    expect(config.chatId).toBe("-100123");
    expect(config.messageLang).toBe("es");
    expect(config.parseMode).toBe("HTML");
    expect(config.apiBaseUrl).toBe("https://api.telegram.org");
    expect(config.pollTimeoutSec).toBe(30);
    expect(config.gatewayUrl).toBe("http://127.0.0.1:4000");
    expect(config.webhookPort).toBe(14120);
    expect(config.gatewayReregisterMs).toBe(60000);
    expect(config.fail2banLogPath).toBe("/var/log/fail2ban.log");
    expect(config.permanentJails).toEqual(["recidive"]);
    expect(config.ignoreJails).toEqual([]);
    expect(config.suppressShutdownFlush).toBe(true);
    expect(config.pollIntervalMs).toBe(1000);
    expect(config.counterBackend).toBe("file");
    expect(config.counterFile).toBe("./data/f2b-counter.json");
    expect(config.logLevel).toBe("info");
    expect(config.threadId).toBeUndefined();
    expect(config.logFile).toBeUndefined();
  });

  it("direct sin token falla con error claro", () => {
    expect(() =>
      loadConfig({ TRANSPORT: "direct", TELEGRAM_CHAT_ID: "1" }),
    ).toThrowError(ConfigError);
    try {
      loadConfig({ TRANSPORT: "direct", TELEGRAM_CHAT_ID: "1" });
    } catch (error) {
      expect((error as Error).message).toContain("TELEGRAM_BOT_TOKEN es obligatorio");
    }
  });

  it("gateway NO exige token", () => {
    const config = loadConfig({ TRANSPORT: "gateway", TELEGRAM_CHAT_ID: "1" });
    expect(config.transport).toBe("gateway");
    expect(config.botToken).toBeUndefined();
  });

  it("sin CHAT_ID falla", () => {
    expect(() => loadConfig({ TRANSPORT: "gateway" })).toThrowError(/TELEGRAM_CHAT_ID/);
  });

  it("agrega varios errores en un único mensaje", () => {
    try {
      loadConfig({
        TRANSPORT: "manzana",
        MESSAGE_LANG: "fr",
        WEBHOOK_PORT: "99999",
        LOG_LEVEL: "verbose",
      });
      throw new Error("no debería llegar aquí");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("TRANSPORT debe ser uno de");
      expect(message).toContain("MESSAGE_LANG debe ser uno de");
      expect(message).toContain("WEBHOOK_PORT debe ser <=");
      expect(message).toContain("LOG_LEVEL debe ser uno de");
    }
  });

  it("F2B_PERMANENT_JAILS vacío ⇒ lista vacía; ausente ⇒ default", () => {
    const empty = loadConfig({
      TRANSPORT: "gateway",
      TELEGRAM_CHAT_ID: "1",
      F2B_PERMANENT_JAILS: "",
    });
    expect(empty.permanentJails).toEqual([]);

    const present = loadConfig({
      TRANSPORT: "gateway",
      TELEGRAM_CHAT_ID: "1",
      F2B_PERMANENT_JAILS: "recidive, sshd",
    });
    expect(present.permanentJails).toEqual(["recidive", "sshd"]);
  });

  it("parsea thread id, booleanos y listas de filtros", () => {
    const config = loadConfig({
      TRANSPORT: "gateway",
      TELEGRAM_CHAT_ID: "1",
      TELEGRAM_TOPIC_ID: "42",
      F2B_SUPPRESS_SHUTDOWN_FLUSH: "false",
      F2B_IGNORE_JAILS: "sshd,apache",
      F2B_IGNORE_IPS: "1.2.3.4",
    });
    expect(config.threadId).toBe(42);
    expect(config.suppressShutdownFlush).toBe(false);
    expect(config.ignoreJails).toEqual(["sshd", "apache"]);
    expect(config.ignoreIps).toEqual(["1.2.3.4"]);
  });

  it("rechaza thread id no entero", () => {
    expect(() =>
      loadConfig({ TRANSPORT: "gateway", TELEGRAM_CHAT_ID: "1", TELEGRAM_TOPIC_ID: "abc" }),
    ).toThrowError(/TELEGRAM_TOPIC_ID/);
  });

  it("normaliza la barra final de las URLs", () => {
    const config = loadConfig({
      TRANSPORT: "gateway",
      TELEGRAM_CHAT_ID: "1",
      TG_GATEWAY_URL: "http://127.0.0.1:4000/",
    });
    expect(config.gatewayUrl).toBe("http://127.0.0.1:4000");
  });
});
