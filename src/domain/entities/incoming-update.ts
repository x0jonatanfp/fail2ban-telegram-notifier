// Entidad de dominio: un update entrante ya normalizado.
//
// El bot recibe updates en dos formas distintas según el transporte: el update
// crudo de Telegram (poller `direct` o webhook que reenvía `tg-gateway`). Este
// tipo abstrae ambos y deja al dominio/application trabajar con una forma
// estable. Los ids se guardan como string porque los IDs de Telegram pueden
// superar el rango seguro de un número de 32 bits.

export type IncomingUpdateKind = "message" | "callback";

export interface IncomingUpdate {
  kind: IncomingUpdateKind;
  /** Chat donde llegó el update. */
  chatId: string;
  /** Autor del mensaje/callback, si el update lo incluye. */
  userId?: number;
  /** `message_id` del mensaje entrante (para poder borrarlo). */
  messageId?: number;
  /** `message_thread_id` (temas de foros), si existe. */
  threadId?: number;
  /** Texto del mensaje (solo `kind === "message"`). */
  text?: string;
  /** `callback_query.id` (solo `kind === "callback"`). */
  callbackId?: string;
  /** `callback_query.data` (solo `kind === "callback"`). */
  callbackData?: string;
}
