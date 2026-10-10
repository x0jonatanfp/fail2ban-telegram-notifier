// Puerto `NotifierPort`: todo lo que el bot necesita para hablar con Telegram.
// Hay dos adaptadores (`infrastructure/telegram/direct` y `.../gateway`); el
// composition root elige uno según `TRANSPORT`.
import type {
  InlineKeyboardMarkup,
  SendMessageOptions,
  SendMessageResult,
} from "../entities/telegram-message.ts";

export interface NotifierPort {
  sendMessage(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<SendMessageResult>;

  deleteMessage(chatId: string, messageId: number): Promise<void>;

  answerCallback(callbackId: string, text?: string): Promise<void>;

  /** Nota: el bot original no usa esto hoy, pero el gateway lo soporta. */
  editReplyMarkup(
    chatId: string,
    messageId: number,
    replyMarkup: InlineKeyboardMarkup,
  ): Promise<void>;
}
