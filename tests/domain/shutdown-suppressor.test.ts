import { describe, expect, it } from "vitest";
import { ShutdownSuppressor } from "../../src/domain/services/shutdown-suppressor.ts";

describe("ShutdownSuppressor (f2b.py:58-88)", () => {
  it("empieza sin suprimir", () => {
    const suppressor = new ShutdownSuppressor();
    expect(suppressor.isSuppressing()).toBe(false);
  });

  it("activa la supresión al ver 'Stopping all jails'", () => {
    const suppressor = new ShutdownSuppressor();
    expect(suppressor.observeMarker("2026-... fail2ban.jail [1]: INFO Stopping all jails")).toBe(
      "shutdown",
    );
    expect(suppressor.isSuppressing()).toBe(true);
  });

  it("activa la supresión con 'Shutdown in progress'", () => {
    const suppressor = new ShutdownSuppressor();
    expect(suppressor.observeMarker("Shutdown in progress")).toBe("shutdown");
    expect(suppressor.isSuppressing()).toBe(true);
  });

  it("desactiva la supresión con 'Starting Fail2ban'", () => {
    const suppressor = new ShutdownSuppressor();
    suppressor.observeMarker("Stopping all jails");
    expect(suppressor.observeMarker("2026-... Starting Fail2ban")).toBe("startup");
    expect(suppressor.isSuppressing()).toBe(false);
  });

  it("devuelve null ante una línea neutra", () => {
    const suppressor = new ShutdownSuppressor();
    expect(suppressor.observeMarker("línea cualquiera")).toBeNull();
  });

  it("reactivate() quita la supresión", () => {
    const suppressor = new ShutdownSuppressor();
    suppressor.observeMarker("Stopping all jails");
    suppressor.reactivate();
    expect(suppressor.isSuppressing()).toBe(false);
  });
});
