// Servicio de dominio puro: plantillas de mensajes (i18n es/en).
//
// Los textos en español son **byte a byte** los del bot original (f2b.py:41,47,
// 109,115,126,138-139,143,166-169,173,194-196,200; user.py:16-22; main.py:71-78);
// los textos en inglés son traducción libre y solo se usan con
// `MESSAGE_LANG=en`. Se conserva el detalle de comillas simples en el atributo
// `class='tg-spoiler'` de `chatIds` (user.py) frente a las dobles del resto.
import type { CounterState } from "../entities/counter-state.ts";
import type { InlineKeyboardMarkup } from "../entities/telegram-message.ts";

export type MessageLang = "es" | "en";

export interface ChatIdInput {
  userId?: number;
  chatId: string;
  threadId?: number;
}

/** Datos mostrados por el teclado de reinicio (¡ojo: `daily`/`permanent` son los
 * valores ANTERIORES al reset y `total` el nuevo acumulado, igual que el
 * original en f2b.py:193-197 y scheduled_tasks.py:32-38). */
export interface ResetKeyboardValues {
  daily: number;
  permanent: number;
  total: number;
}

export interface MessageTemplates {
  ban(ip: string, jail: string): string;
  permanentBan(ip: string, jail: string): string;
  unban(ip: string, jail: string): string;
  logRotationSize(): string;
  logRotationInode(): string;
  configTitle(): string;
  configKeyboard(): InlineKeyboardMarkup;
  counterTitle(): string;
  counterKeyboard(state: CounterState): InlineKeyboardMarkup;
  resetTitle(): string;
  resetKeyboard(values: ResetKeyboardValues): InlineKeyboardMarkup;
  chatIds(input: ChatIdInput): string;
  start(): string;
  help(): string;
  /** Resumen batch: cabecera fija, sin horas ("Última hora"). */
  batchTitle(): string;
  /** Segmento de bloqueos; `breakdown` vacío ⇒ sin paréntesis. */
  batchBans(count: number, breakdown: string): string;
  /** Segmento de desbloqueos (recuento). */
  batchUnbans(count: number): string;
  /** Plegado de jails sobrantes ("otras N" / "other N"). */
  batchOther(total: number): string;
  /** Entrada del desglose sin IPs ("sshd 41"). */
  batchJailCount(jail: string, count: number): string;
  /** Bloque de jail con IPs ("sshd (41): <spoiler>…</spoiler>, …"). */
  batchJailIps(jail: string, count: number, ips: string): string;
  /** Una IP envuelta en spoiler (misma etiqueta que el resto de plantillas). */
  batchSpoilerIp(ip: string): string;
}

/** El original mostraría `None` si `last` es nulo (helpers.py:86,98); usamos "-"
 * por presentación (no cambia la semántica del contador). */
function displayLast(last: string | null): string {
  return last ?? "-";
}

const NOOP = "noop";

function counterRows(
  daily: number,
  permanent: number,
  total: number,
  last: string | null,
  labels: { daily: string; permanent: string; total: string; last: string },
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: `${labels.daily}: ${daily}`, callback_data: NOOP }],
      [{ text: `${labels.permanent}: ${permanent}`, callback_data: NOOP }],
      [{ text: `${labels.total}: ${total}`, callback_data: NOOP }],
      [{ text: `${labels.last}: ${displayLast(last)}`, callback_data: NOOP }],
    ],
  };
}

const es: MessageTemplates = {
  ban: (ip, jail) =>
    `🔒 IP <span class="tg-spoiler">${ip}</span> ha sido <b>bloqueada</b> por <b><i>${jail}</i></b>.`,
  permanentBan: (ip, jail) =>
    `🚫 IP <span class="tg-spoiler">${ip}</span> ha sido bloqueada permanentemente por <i>${jail}</i>.`,
  unban: (ip, jail) =>
    `🌐 IP <span class="tg-spoiler">${ip}</span> ha sido <b>desbloqueada</b> por <i>${jail}</i>.`,
  logRotationSize: () =>
    "<b>🔄 Rotación de log detectada, reabriendo...</b>",
  logRotationInode: () =>
    "<b>📂 Reemplazo de log detectado, reabriendo...</b>",
  configTitle: () => "🛠️ <b>Configuración F2B</b>",
  configKeyboard: () => ({
    inline_keyboard: [
      [
        { text: "📊 ¡Mostrar valores!", callback_data: "show_counter" },
        { text: "⚠️ ¡No tocar!", callback_data: "not_touch" },
      ],
    ],
  }),
  counterTitle: () => "<b>📊 CONTADOR DE BLOQUEOS</b>",
  counterKeyboard: (state) =>
    counterRows(state.daily, state.permanent, state.total, state.last, {
      daily: "📈 Diarios",
      permanent: "🚫 Reincidentes",
      total: "🔒 Totales",
      last: "⏲️ Última acción",
    }),
  resetTitle: () => "<b>🔄 ¡CONTADOR REINICIADO!</b>",
  resetKeyboard: (values) => ({
    inline_keyboard: [
      [{ text: `📊 Diarios: ${values.daily}`, callback_data: NOOP }],
      [{ text: `🚫 Reincidentes: ${values.permanent}`, callback_data: NOOP }],
      [{ text: `🔒 Totales: ${values.total}`, callback_data: NOOP }],
    ],
  }),
  chatIds: (input) => {
    const threadText =
      input.threadId !== undefined
        ? `\n📂 <b>ID del Tema:</b> <span class='tg-spoiler'>${input.threadId}</span>`
        : "";
    return (
      `👤 <b>Tu User ID:</b> <span class='tg-spoiler'>${input.userId ?? "-"}</span>\n` +
      `💬 <b>Chat/Grupo ID:</b> <span class='tg-spoiler'>${input.chatId}</span>` +
      `${threadText}\n` +
      `🔍 <b>¡Guárdalo de forma segura!</b> 🔒`
    );
  },
  batchTitle: () => "📊 Última hora",
  batchBans: (count, breakdown) =>
    breakdown === ""
      ? `🔒 ${count} ${count === 1 ? "bloqueo" : "bloqueos"}`
      : `🔒 ${count} ${count === 1 ? "bloqueo" : "bloqueos"} (${breakdown})`,
  batchUnbans: (count) => `🌐 ${count} ${count === 1 ? "desbloqueo" : "desbloqueos"}`,
  batchOther: (total) => `otras ${total}`,
  batchJailCount: (jail, count) => `${jail} ${count}`,
  batchJailIps: (jail, count, ips) => `${jail} (${count}): ${ips}`,
  batchSpoilerIp: (ip) => `<span class="tg-spoiler">${ip}</span>`,
  start: () => "Hola. Usa /chat_id o /f2b.",
  help: () =>
    "🛠️ <b>Comandos:</b>\n" +
    "/chat_id - IDs de chat\n" +
    "/f2b - Estadísticas\n" +
    "/help - Ayuda",
};

const en: MessageTemplates = {
  ban: (ip, jail) =>
    `🔒 IP <span class="tg-spoiler">${ip}</span> has been <b>banned</b> by <b><i>${jail}</i></b>.`,
  permanentBan: (ip, jail) =>
    `🚫 IP <span class="tg-spoiler">${ip}</span> has been permanently banned by <i>${jail}</i>.`,
  unban: (ip, jail) =>
    `🌐 IP <span class="tg-spoiler">${ip}</span> has been <b>unbanned</b> by <i>${jail}</i>.`,
  logRotationSize: () => "<b>🔄 Log rotation detected, reopening...</b>",
  logRotationInode: () => "<b>📂 Log file replaced, reopening...</b>",
  configTitle: () => "🛠️ <b>F2B settings</b>",
  configKeyboard: () => ({
    inline_keyboard: [
      [
        { text: "📊 Show values!", callback_data: "show_counter" },
        { text: "⚠️ Don't touch!", callback_data: "not_touch" },
      ],
    ],
  }),
  counterTitle: () => "<b>📊 BAN COUNTER</b>",
  counterKeyboard: (state) =>
    counterRows(state.daily, state.permanent, state.total, state.last, {
      daily: "📈 Daily",
      permanent: "🚫 Reoffenders",
      total: "🔒 Total",
      last: "⏲️ Last action",
    }),
  resetTitle: () => "<b>🔄 COUNTER RESET!</b>",
  resetKeyboard: (values) => ({
    inline_keyboard: [
      [{ text: `📈 Daily: ${values.daily}`, callback_data: NOOP }],
      [{ text: `🚫 Reoffenders: ${values.permanent}`, callback_data: NOOP }],
      [{ text: `🔒 Total: ${values.total}`, callback_data: NOOP }],
    ],
  }),
  chatIds: (input) => {
    const threadText =
      input.threadId !== undefined
        ? `\n📂 <b>Topic ID:</b> <span class='tg-spoiler'>${input.threadId}</span>`
        : "";
    return (
      `👤 <b>Your User ID:</b> <span class='tg-spoiler'>${input.userId ?? "-"}</span>\n` +
      `💬 <b>Chat/Group ID:</b> <span class='tg-spoiler'>${input.chatId}</span>` +
      `${threadText}\n` +
      `🔍 <b>Keep it somewhere safe!</b> 🔒`
    );
  },
  batchTitle: () => "📊 Last hour",
  batchBans: (count, breakdown) =>
    breakdown === ""
      ? `🔒 ${count} ${count === 1 ? "ban" : "bans"}`
      : `🔒 ${count} ${count === 1 ? "ban" : "bans"} (${breakdown})`,
  batchUnbans: (count) => `🌐 ${count} ${count === 1 ? "unban" : "unbans"}`,
  batchOther: (total) => `other ${total}`,
  batchJailCount: (jail, count) => `${jail} ${count}`,
  batchJailIps: (jail, count, ips) => `${jail} (${count}): ${ips}`,
  batchSpoilerIp: (ip) => `<span class="tg-spoiler">${ip}</span>`,
  start: () => "Hi. Use /chat_id or /f2b.",
  help: () =>
    "🛠️ <b>Commands:</b>\n" +
    "/chat_id - Chat IDs\n" +
    "/f2b - Statistics\n" +
    "/help - Help",
};

const TEMPLATES: Record<MessageLang, MessageTemplates> = { es, en };

export function getMessages(lang: MessageLang): MessageTemplates {
  return TEMPLATES[lang];
}
