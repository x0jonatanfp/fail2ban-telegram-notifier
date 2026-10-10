// Entidades de dominio para el envío de mensajes.
//
// Solo se modela lo que el bot usa: teclados inline, opciones de envío y el
// resultado mínimo (id del mensaje enviado, necesario para el autoborrado).

export interface InlineKeyboardButton {
  text: string;
  /** `callback_data`; el gateway enruta los callbacks por su prefijo. */
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface SendMessageOptions {
  /** Modo de parseo; si se omite, el adaptador usa su valor por defecto. */
  parseMode?: string;
  replyMarkup?: InlineKeyboardMarkup;
  /** Tema destino; solo se aplica en el transporte `direct`. */
  threadId?: number;
}

export interface SendMessageResult {
  messageId?: number;
}
