// Adaptador `NotifierPort` para el transporte `gateway` (tg-gateway local).
//
// Contrato verificado en el código del tg-gateway local:
//   - POST /api/send              { chat_id, text, parse_mode, reply_markup }
//                                 → 200 { ok:true, result:{ chatId, messageId } }
//                                   o 502 { ok:false } si Telegram lo rechazó
//                                 (api-server.ts:103-115, 56-67)
//   - POST /api/delete-message    { chat_id, message_id }        → { ok:true } (:177-187)
//   - POST /api/answer-callback   { callback_id, text }          → { ok:true } (:190-200)
//   - POST /api/edit-reply-markup { chat_id, message_id, reply_markup } → { ok:true } (:163-174)
//
// LIMITACIÓN CONOCIDA: /api/send NO acepta `message_thread_id` (api-server.ts:105-110),
// así que en este transporte los temas se ignoran a propósito (no se envía).
import type { InlineKeyboardMarkup, SendMessageOptions, SendMessageResult } from "../../../domain/entities/telegram-message.ts";
import type { NotifierPort } from "../../../domain/ports/notifier.ts";

export interface GatewayNotifierOptions {
  gatewayUrl: string;
  parseMode: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10000;

interface GatewayResponse {
  ok?: boolean;
  error?: string;
  result?: { messageId?: number };
}

export class GatewayNotifier implements NotifierPort {
  constructor(private readonly options: GatewayNotifierOptions) {}

  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  private async post(path: string, payload: Record<string, unknown>): Promise<GatewayResponse> {
    const response = await this.fetchImpl(`${this.options.gatewayUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    let json: GatewayResponse | undefined;
    try {
      json = (await response.json()) as GatewayResponse;
    } catch {
      json = undefined;
    }

    if (!response.ok || json?.ok === false) {
      const detail = json?.error ?? `HTTP ${response.status}`;
      throw new Error(`tg-gateway ${path} falló: ${detail}`);
    }
    return json ?? {};
  }

  async sendMessage(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<SendMessageResult> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: options?.parseMode ?? this.options.parseMode,
    };
    if (options?.replyMarkup !== undefined) payload.reply_markup = options.replyMarkup;
    // `message_thread_id` NO se envía: el gateway lo ignora (ver cabecera).

    const json = await this.post("/api/send", payload);
    const messageId = json.result?.messageId;
    return messageId !== undefined ? { messageId } : {};
  }

  async deleteMessage(chatId: string, messageId: number): Promise<void> {
    await this.post("/api/delete-message", { chat_id: chatId, message_id: messageId });
  }

  async answerCallback(callbackId: string, text = ""): Promise<void> {
    await this.post("/api/answer-callback", { callback_id: callbackId, text });
  }

  async editReplyMarkup(
    chatId: string,
    messageId: number,
    replyMarkup: InlineKeyboardMarkup,
  ): Promise<void> {
    await this.post("/api/edit-reply-markup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    });
  }
}
