// Adaptador `NotifierPort` para el transporte `direct` (Bot API de Telegram).
//
// Aquí SÍ se soporta `message_thread_id` (temas de foro): es el transporte por
// defecto y público. Usa `fetch` global de Node (sin dependencias). En modo
// `direct` no hay rate-limit del gateway, así que se aplica un timeout por
// petición y se propaga el error para que el caso de uso lo registre.
import type { InlineKeyboardMarkup, SendMessageOptions, SendMessageResult } from "../../../domain/entities/telegram-message.ts";
import type { NotifierPort } from "../../../domain/ports/notifier.ts";

export interface DirectNotifierOptions {
  token: string;
  apiBaseUrl: string;
  parseMode: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;

interface TelegramResponse {
  ok?: boolean;
  description?: string;
  result?: { message_id?: number };
}

export class DirectNotifier implements NotifierPort {
  constructor(private readonly options: DirectNotifierOptions) {}

  private url(method: string): string {
    return `${this.options.apiBaseUrl}/bot${this.options.token}/${method}`;
  }

  private async call(method: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(this.url(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    let json: TelegramResponse | undefined;
    try {
      json = (await response.json()) as TelegramResponse;
    } catch {
      json = undefined;
    }

    if (!response.ok || json?.ok === false) {
      const detail = json?.description ?? `HTTP ${response.status}`;
      throw new Error(`Telegram ${method} falló: ${detail}`);
    }
    return json?.result;
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
    if (options?.threadId !== undefined) payload.message_thread_id = options.threadId;

    const result = (await this.call("sendMessage", payload)) as
      | { message_id?: number }
      | undefined;
    return result?.message_id !== undefined ? { messageId: result.message_id } : {};
  }

  async deleteMessage(chatId: string, messageId: number): Promise<void> {
    await this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  async answerCallback(callbackId: string, text = ""): Promise<void> {
    await this.call("answerCallbackQuery", {
      callback_query_id: callbackId,
      text,
    });
  }

  async editReplyMarkup(
    chatId: string,
    messageId: number,
    replyMarkup: InlineKeyboardMarkup,
  ): Promise<void> {
    await this.call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    });
  }
}
