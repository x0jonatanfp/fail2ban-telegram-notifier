// Entidades de dominio para eventos de fail2ban.
//
// `Fail2banLogEntry` es el resultado crudo del parseo de una línea de log (la
// acción es un texto libre: el log contiene "Ban", "Unban", "Found",
// "Restore"…). `Fail2banEvent` es el subconjunto de acciones que el bot
// notifica, ya normalizado a minúsculas.

export type Fail2banAction = "ban" | "unban";

/** Acciones notificadas por el bot. */
export interface Fail2banEvent {
  jail: string;
  action: Fail2banAction;
  ip: string;
}

/** Línea de `fail2ban.log` parseada; `action` conserva el texto original. */
export interface Fail2banLogEntry {
  jail: string;
  action: string;
  ip: string;
}
