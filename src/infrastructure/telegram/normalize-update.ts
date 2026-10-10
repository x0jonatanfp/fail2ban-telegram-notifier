// Normaliza un update CRUDO de Telegram a la entidad de dominio
// `IncomingUpdate`. Se usa desde ambos transportes: el poller `direct` lee
// `getUpdates` y el webhook `gateway` recibe el update reenviado por tg-gateway.
// Se leen los campos de forma defensiva (todo opcional) porque el update es
// entrada no confiable.
import type { IncomingUpdate } from "../../domain/entities/incoming-update.ts";

interface RawChat {
  id?: number | string;
}

interface RawMessage {
  message_id?: number;
  text?: string;
  message_thread_id?: number;
  chat?: RawChat;
  from?: { id?: number };
}

interface RawCallbackQuery {
  id?: string;
  data?: string;
  from?: { id?: number };
  message?: { message_id?: number; chat?: RawChat };
}

interface RawUpdate {
  update_id?: number;
  message?: RawMessage;
  callback_query?: RawCallbackQuery;
}

function chatIdOf(chat: RawChat | undefined): string | undefined {
  return chat?.id === undefined ? undefined : String(chat.id);
}

export function normalizeUpdate(raw: unknown): IncomingUpdate | null {
  if (raw === null || typeof raw !== "object") return null;
  const update = raw as RawUpdate;

  if (update.callback_query !== undefined) {
    const callback = update.callback_query;
    const chatId = chatIdOf(callback.message?.chat);
    if (chatId === undefined) return null;
    return {
      kind: "callback",
      chatId,
      ...(callback.from?.id !== undefined ? { userId: callback.from.id } : {}),
      ...(callback.message?.message_id !== undefined
        ? { messageId: callback.message.message_id }
        : {}),
      ...(callback.id !== undefined ? { callbackId: callback.id } : {}),
      ...(callback.data !== undefined ? { callbackData: callback.data } : {}),
    };
  }

  if (update.message !== undefined) {
    const message = update.message;
    const chatId = chatIdOf(message.chat);
    if (chatId === undefined) return null;
    return {
      kind: "message",
      chatId,
      ...(message.from?.id !== undefined ? { userId: message.from.id } : {}),
      ...(message.message_id !== undefined ? { messageId: message.message_id } : {}),
      ...(message.message_thread_id !== undefined
        ? { threadId: message.message_thread_id }
        : {}),
      ...(message.text !== undefined ? { text: message.text } : {}),
    };
  }

  return null;
}
