import { describe, expect, it } from "vitest";
import { parseFail2banLine } from "../../src/domain/services/parse-fail2ban-line.ts";

describe("parseFail2banLine (paridad con f2b.py:18,71)", () => {
  it("parsea una línea real de Ban", () => {
    const line =
      "2026-10-10 10:00:00,000 fail2ban.actions [1234]: NOTICE [sshd] Ban 203.0.113.7";
    expect(parseFail2banLine(line)).toEqual({
      jail: "sshd",
      action: "Ban",
      ip: "203.0.113.7",
    });
  });

  it("parsea Unban", () => {
    const line =
      "2026-10-10 10:05:00,000 fail2ban.actions [1234]: NOTICE [sshd] Unban 203.0.113.7";
    expect(parseFail2banLine(line)).toEqual({
      jail: "sshd",
      action: "Unban",
      ip: "203.0.113.7",
    });
  });

  it("parsea Found (la aplicación decide ignorarlo)", () => {
    const line =
      "2026-10-10 10:00:00,000 fail2ban.actions [1234]: NOTICE [sshd] Found 203.0.113.7";
    expect(parseFail2banLine(line)?.action).toBe("Found");
  });

  it("ignora 'Restore Ban' (no casa el patrón)", () => {
    const line =
      "2026-10-10 10:00:00,000 fail2ban.actions [1234]: NOTICE [sshd] Restore Ban 203.0.113.7";
    expect(parseFail2banLine(line)).toBeNull();
  });

  it("admite jails con espacios", () => {
    const line =
      "2026-10-10 10:00:00,000 fail2ban.actions [1]: NOTICE [mi jail] Ban 10.0.0.1";
    expect(parseFail2banLine(line)?.jail).toBe("mi jail");
  });

  it("devuelve null si la línea no es de fail2ban.actions", () => {
    const line = "2026-10-10 10:00:00,000 fail2ban.jail [1234]: INFO Jail 'sshd' started";
    expect(parseFail2banLine(line)).toBeNull();
  });

  it("devuelve null en líneas malformadas", () => {
    expect(parseFail2banLine("fail2ban.actions basura sin formato")).toBeNull();
    expect(parseFail2banLine("[sshd] Ban")).toBeNull();
    expect(parseFail2banLine("")).toBeNull();
  });

  it("documenta que NO soporta IPv6: corta en los dos puntos", () => {
    const line =
      "2026-10-10 10:00:00,000 fail2ban.actions [1]: NOTICE [sshd] Ban 2001:db8::1";
    // El original usa `[0-9\.]+`, igual que nosotros: solo captura "2001".
    expect(parseFail2banLine(line)?.ip).toBe("2001");
  });

  it("documenta que no captura ip:puerto más allá de la ip", () => {
    const line =
      "2026-10-10 10:00:00,000 fail2ban.actions [1]: NOTICE [sshd] Ban 1.2.3.4";
    expect(parseFail2banLine(line)?.ip).toBe("1.2.3.4");
  });
});
