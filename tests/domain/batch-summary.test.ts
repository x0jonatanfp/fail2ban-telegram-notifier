import { describe, expect, it } from "vitest";
import {
  formatBatchSummary,
  MAX_JAILS_SHOWN,
  TELEGRAM_MAX_MESSAGE_LEN,
  type BatchSummaryData,
} from "../../src/domain/services/batch-summary.ts";
import { getMessages } from "../../src/domain/services/message-format.ts";

const es = getMessages("es");
const en = getMessages("en");

const win = (sh: number, eh: number): Pick<BatchSummaryData, "windowStart" | "windowEnd"> => ({
  windowStart: new Date(2026, 9, 10, sh, 0, 0),
  windowEnd: new Date(2026, 9, 10, eh, 0, 0),
});

const bans = (jail: string, n: number, base = "1.2.3"): BatchSummaryData["bans"] =>
  Array.from({ length: n }, (_, i) => ({ jail, ip: `${base}.${i + 1}` }));

describe("formatBatchSummary", () => {
  it("ejemplo exacto de la especificación (es)", () => {
    const texts = formatBatchSummary(
      {
        ...win(3, 4),
        bans: bans("nginx-botsearch", 2, "10.0.0"),
        unbans: [{ jail: "sshd", ip: "9.9.9.9" }],
        showIps: false,
        unbanMode: "count",
      },
      es,
    );
    expect(texts).toEqual([
      "📊 Resumen 03:00–04:00 · 🔒 2 bloqueos (nginx-botsearch 2) · 🌐 1 desbloqueo",
    ]);
  });

  it("una sola línea: ningún mensaje contiene \\n", () => {
    const texts = formatBatchSummary(
      {
        ...win(14, 15),
        bans: [...bans("postfix", 3), ...bans("sshd", 1)],
        unbans: [{ jail: "x", ip: "1.1.1.1" }],
        showIps: true,
        unbanMode: "list",
      },
      es,
    );
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text).not.toContain("\n");
      expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LEN);
    }
  });

  it("singular/plural en es y en", () => {
    const one = formatBatchSummary(
      { ...win(14, 15), bans: bans("sshd", 1), unbans: [], showIps: false, unbanMode: "count" },
      es,
    );
    expect(one).toEqual(["📊 Resumen 14:00–15:00 · 🔒 1 bloqueo (sshd 1)"]);

    const oneEn = formatBatchSummary(
      {
        ...win(14, 15),
        bans: bans("sshd", 1),
        unbans: [{ jail: "sshd", ip: "1.1.1.1" }],
        showIps: false,
        unbanMode: "count",
      },
      en,
    );
    expect(oneEn).toEqual(["📊 Summary 14:00–15:00 · 🔒 1 ban (sshd 1) · 🌐 1 unban"]);

    const manyEn = formatBatchSummary(
      { ...win(14, 15), bans: bans("sshd", 62), unbans: bans("x", 58, "8.8.8"), showIps: false, unbanMode: "count" },
      en,
    );
    expect(manyEn).toEqual(["📊 Summary 14:00–15:00 · 🔒 62 bans (sshd 62) · 🌐 58 unbans"]);
  });

  it("ordena jails por recuento (empates por nombre)", () => {
    const texts = formatBatchSummary(
      {
        ...win(14, 15),
        bans: [...bans("b-jail", 2), ...bans("a-jail", 2), ...bans("top", 5)],
        unbans: [],
        showIps: false,
        unbanMode: "count",
      },
      es,
    );
    expect(texts).toEqual(["📊 Resumen 14:00–15:00 · 🔒 9 bloqueos (top 5, a-jail 2, b-jail 2)"]);
  });

  it("pliega a partir de 8 jails en `otras N` / `other N`", () => {
    const many = Array.from({ length: MAX_JAILS_SHOWN + 3 }, (_, i) => ({
      jail: `jail-${String(i).padStart(2, "0")}`,
      ip: `10.0.0.${i + 1}`,
    }));
    const texts = formatBatchSummary(
      { ...win(14, 15), bans: many, unbans: [], showIps: false, unbanMode: "count" },
      es,
    );
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("otras 3");
    expect(texts[0]).not.toContain("jail-08");

    const textsEn = formatBatchSummary(
      { ...win(14, 15), bans: many, unbans: [], showIps: false, unbanMode: "count" },
      en,
    );
    expect(textsEn[0]).toContain("other 3");
  });

  it("con IPs añade un bloque por jail con spoilers", () => {
    const texts = formatBatchSummary(
      {
        ...win(14, 15),
        bans: [
          { jail: "postfix", ip: "1.2.3.4" },
          { jail: "postfix", ip: "5.6.7.8" },
        ],
        unbans: [],
        showIps: true,
        unbanMode: "count",
      },
      es,
    );
    expect(texts).toEqual([
      "📊 Resumen 14:00–15:00 · 🔒 2 bloqueos · postfix (2): " +
        "<span class=\"tg-spoiler\">1.2.3.4</span>, <span class=\"tg-spoiler\">5.6.7.8</span>",
    ]);
  });

  it("NOTIFY_UNBANS=off omite los desbloqueos; solo-unbans no envía nada", () => {
    const mixed = formatBatchSummary(
      {
        ...win(14, 15),
        bans: bans("sshd", 1),
        unbans: [{ jail: "sshd", ip: "9.9.9.9" }],
        showIps: false,
        unbanMode: "off",
      },
      es,
    );
    expect(mixed).toEqual(["📊 Resumen 14:00–15:00 · 🔒 1 bloqueo (sshd 1)"]);

    const onlyUnbans = formatBatchSummary(
      {
        ...win(14, 15),
        bans: [],
        unbans: [{ jail: "sshd", ip: "9.9.9.9" }],
        showIps: false,
        unbanMode: "off",
      },
      es,
    );
    expect(onlyUnbans).toEqual([]);
  });

  it("solo-unbans omite el segmento de bloqueos; solo-bans omite el de desbloqueos", () => {
    const onlyUnbans = formatBatchSummary(
      {
        ...win(14, 15),
        bans: [],
        unbans: [{ jail: "sshd", ip: "9.9.9.9" }, { jail: "sshd", ip: "9.9.9.10" }],
        showIps: false,
        unbanMode: "count",
      },
      es,
    );
    expect(onlyUnbans).toEqual(["📊 Resumen 14:00–15:00 · 🌐 2 desbloqueos"]);

    const onlyBans = formatBatchSummary(
      { ...win(14, 15), bans: bans("sshd", 2), unbans: [], showIps: false, unbanMode: "count" },
      es,
    );
    expect(onlyBans).toEqual(["📊 Resumen 14:00–15:00 · 🔒 2 bloqueos (sshd 2)"]);
  });

  it("ventana vacía no envía nada", () => {
    expect(
      formatBatchSummary({ ...win(14, 15), bans: [], unbans: [], showIps: false, unbanMode: "count" }, es),
    ).toEqual([]);
  });

  it("unbanMode=list con IPs añade las desbloqueadas", () => {
    const texts = formatBatchSummary(
      {
        ...win(14, 15),
        bans: bans("sshd", 1),
        unbans: [{ jail: "postfix", ip: "7.7.7.7" }],
        showIps: true,
        unbanMode: "list",
      },
      es,
    );
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("🌐 1 desbloqueo");
    expect(texts[0]).toContain("postfix (1): <span class=\"tg-spoiler\">7.7.7.7</span>");
  });

  it("trocea a 4096 sin cortar etiquetas ni spoilers", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ jail: "postfix", ip: `10.9.9.${i + 1}` }));
    const texts = formatBatchSummary(
      { ...win(14, 15), bans: many, unbans: [], showIps: true, unbanMode: "count" },
      es,
    );
    expect(texts.length).toBeGreaterThan(1);
    for (const text of texts) {
      expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LEN);
      expect(text).not.toContain("\n");
      // Sin etiquetas a medias: cada apertura se cierra en el mismo mensaje.
      const opens = text.split("<span").length - 1;
      const closes = text.split("</span>").length - 1;
      expect(closes).toBe(opens);
      expect(text).not.toMatch(/<span[^>]*$/);
    }
    // Cada trozo de jail mantiene su etiqueta.
    for (const text of texts.slice(1)) {
      expect(text).toContain("postfix (300):");
    }
  });
});
