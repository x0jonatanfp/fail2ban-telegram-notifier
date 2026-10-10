import { describe, expect, it } from "vitest";
import { getMessages } from "../../src/domain/services/message-format.ts";

const es = getMessages("es");
const en = getMessages("en");

describe("message-format (es: paridad byte a byte)", () => {
  it("ban normal (f2b.py:115)", () => {
    expect(es.ban("1.2.3.4", "sshd")).toBe(
      '🔒 IP <span class="tg-spoiler">1.2.3.4</span> ha sido <b>bloqueada</b> por <b><i>sshd</i></b>.',
    );
  });

  it("ban permanente (f2b.py:109)", () => {
    expect(es.permanentBan("1.2.3.4", "recidive")).toBe(
      '🚫 IP <span class="tg-spoiler">1.2.3.4</span> ha sido bloqueada permanentemente por <i>recidive</i>.',
    );
  });

  it("unban (f2b.py:126)", () => {
    expect(es.unban("1.2.3.4", "sshd")).toBe(
      '🌐 IP <span class="tg-spoiler">1.2.3.4</span> ha sido <b>desbloqueada</b> por <i>sshd</i>.',
    );
  });

  it("avisos de rotación (f2b.py:41,47)", () => {
    expect(es.logRotationSize()).toBe(
      "<b>🔄 Rotación de log detectada, reabriendo...</b>",
    );
    expect(es.logRotationInode()).toBe(
      "<b>📂 Reemplazo de log detectado, reabriendo...</b>",
    );
  });

  it("título y teclado de /f2b (f2b.py:135-143)", () => {
    expect(es.configTitle()).toBe("🛠️ <b>Configuración F2B</b>");
    expect(es.configKeyboard()).toEqual({
      inline_keyboard: [
        [
          { text: "📊 ¡Mostrar valores!", callback_data: "show_counter" },
          { text: "⚠️ ¡No tocar!", callback_data: "not_touch" },
        ],
      ],
    });
  });

  it("título y teclado del contador (f2b.py:164-173)", () => {
    expect(es.counterTitle()).toBe("<b>📊 CONTADOR DE BLOQUEOS</b>");
    expect(
      es.counterKeyboard({ daily: 3, permanent: 1, total: 10, last: "12:34:56" }),
    ).toEqual({
      inline_keyboard: [
        [{ text: "📈 Diarios: 3", callback_data: "noop" }],
        [{ text: "🚫 Reincidentes: 1", callback_data: "noop" }],
        [{ text: "🔒 Totales: 10", callback_data: "noop" }],
        [{ text: "⏲️ Última acción: 12:34:56", callback_data: "noop" }],
      ],
    });
  });

  it("teclado del contador con last nulo usa '-'", () => {
    const keyboard = es.counterKeyboard({
      daily: 0,
      permanent: 0,
      total: 0,
      last: null,
    });
    expect(keyboard.inline_keyboard[3]?.[0]?.text).toBe("⏲️ Última acción: -");
  });

  it("título y teclado de reinicio (f2b.py:192-200)", () => {
    expect(es.resetTitle()).toBe("<b>🔄 ¡CONTADOR REINICIADO!</b>");
    expect(es.resetKeyboard({ daily: 3, permanent: 1, total: 10 })).toEqual({
      inline_keyboard: [
        [{ text: "📊 Diarios: 3", callback_data: "noop" }],
        [{ text: "🚫 Reincidentes: 1", callback_data: "noop" }],
        [{ text: "🔒 Totales: 10", callback_data: "noop" }],
      ],
    });
  });

  it("/chat_id sin tema (user.py:18-23)", () => {
    expect(es.chatIds({ userId: 42, chatId: "-100999" })).toBe(
      "👤 <b>Tu User ID:</b> <span class='tg-spoiler'>42</span>\n" +
        "💬 <b>Chat/Grupo ID:</b> <span class='tg-spoiler'>-100999</span>\n" +
        "🔍 <b>¡Guárdalo de forma segura!</b> 🔒",
    );
  });

  it("/chat_id con tema", () => {
    expect(es.chatIds({ userId: 42, chatId: "-100999", threadId: 7 })).toBe(
      "👤 <b>Tu User ID:</b> <span class='tg-spoiler'>42</span>\n" +
        "💬 <b>Chat/Grupo ID:</b> <span class='tg-spoiler'>-100999</span>" +
        "\n📂 <b>ID del Tema:</b> <span class='tg-spoiler'>7</span>\n" +
        "🔍 <b>¡Guárdalo de forma segura!</b> 🔒",
    );
  });

  it("/start y /help (main.py:71-78)", () => {
    expect(es.start()).toBe("Hola. Usa /chat_id o /f2b.");
    expect(es.help()).toBe(
      "🛠️ <b>Comandos:</b>\n/chat_id - IDs de chat\n/f2b - Estadísticas\n/help - Ayuda",
    );
  });

  it("/chat_id sin user id ni tema usa '-' y omite el tema", () => {
    const text = es.chatIds({ chatId: "-100" });
    expect(text).toBe(
      "👤 <b>Tu User ID:</b> <span class='tg-spoiler'>-</span>\n" +
        "💬 <b>Chat/Grupo ID:</b> <span class='tg-spoiler'>-100</span>\n" +
        "🔍 <b>¡Guárdalo de forma segura!</b> 🔒",
    );
    expect(text).not.toContain("ID del Tema");
  });
});

describe("message-format (en: traducción)", () => {
  it("produce textos y teclados en inglés", () => {
    expect(en.ban("1.2.3.4", "sshd")).toBe(
      '🔒 IP <span class="tg-spoiler">1.2.3.4</span> has been <b>banned</b> by <b><i>sshd</i></b>.',
    );
    expect(en.permanentBan("1.2.3.4", "recidive")).toBe(
      '🚫 IP <span class="tg-spoiler">1.2.3.4</span> has been permanently banned by <i>recidive</i>.',
    );
    expect(en.unban("1.2.3.4", "sshd")).toBe(
      '🌐 IP <span class="tg-spoiler">1.2.3.4</span> has been <b>unbanned</b> by <i>sshd</i>.',
    );
    expect(en.logRotationSize()).toBe("<b>🔄 Log rotation detected, reopening...</b>");
    expect(en.logRotationInode()).toBe("<b>📂 Log file replaced, reopening...</b>");
    expect(en.configTitle()).toBe("🛠️ <b>F2B settings</b>");
    expect(en.configKeyboard()).toEqual({
      inline_keyboard: [
        [
          { text: "📊 Show values!", callback_data: "show_counter" },
          { text: "⚠️ Don't touch!", callback_data: "not_touch" },
        ],
      ],
    });
    expect(en.counterTitle()).toBe("<b>📊 BAN COUNTER</b>");
    expect(
      en.counterKeyboard({ daily: 3, permanent: 1, total: 10, last: "12:34:56" }),
    ).toEqual({
      inline_keyboard: [
        [{ text: "📈 Daily: 3", callback_data: "noop" }],
        [{ text: "🚫 Reoffenders: 1", callback_data: "noop" }],
        [{ text: "🔒 Total: 10", callback_data: "noop" }],
        [{ text: "⏲️ Last action: 12:34:56", callback_data: "noop" }],
      ],
    });
    expect(en.resetTitle()).toBe("<b>🔄 COUNTER RESET!</b>");
    expect(en.resetKeyboard({ daily: 3, permanent: 1, total: 10 })).toEqual({
      inline_keyboard: [
        [{ text: "📈 Daily: 3", callback_data: "noop" }],
        [{ text: "🚫 Reoffenders: 1", callback_data: "noop" }],
        [{ text: "🔒 Total: 10", callback_data: "noop" }],
      ],
    });
    expect(en.start()).toBe("Hi. Use /chat_id or /f2b.");
    expect(en.help()).toBe(
      "🛠️ <b>Commands:</b>\n/chat_id - Chat IDs\n/f2b - Statistics\n/help - Help",
    );
  });

  it("chat_id en inglés: con y sin tema, y con userId ausente", () => {
    expect(en.chatIds({ userId: 42, chatId: "-100999", threadId: 7 })).toBe(
      "👤 <b>Your User ID:</b> <span class='tg-spoiler'>42</span>\n" +
        "💬 <b>Chat/Group ID:</b> <span class='tg-spoiler'>-100999</span>" +
        "\n📂 <b>Topic ID:</b> <span class='tg-spoiler'>7</span>\n" +
        "🔍 <b>Keep it somewhere safe!</b> 🔒",
    );
    // Sin threadId y sin userId: ramas de fallback.
    expect(en.chatIds({ chatId: "-100" })).toBe(
      "👤 <b>Your User ID:</b> <span class='tg-spoiler'>-</span>\n" +
        "💬 <b>Chat/Group ID:</b> <span class='tg-spoiler'>-100</span>\n" +
        "🔍 <b>Keep it somewhere safe!</b> 🔒",
    );
  });
});
