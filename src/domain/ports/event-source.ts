// Puerto `EventSourcePort`: origen de eventos del log de fail2ban.
//
// Emite dos tipos de señal:
//  - `line`: una línea CRUDA del log. Se emiten líneas (no solo eventos
//    fail2ban) a propósito, porque los marcadores de apagado/arranque de
//    fail2ban ("Stopping all jails", "Starting Fail2ban"…) viven en líneas que
//    NO son de `fail2ban.actions`. El parseo y la supresión ocurren en el
//    dominio/application, para poder probarlos sin I/O.
//  - `rotation`: aviso de que el fichero rotó (por tamaño o por inode), para
//    que la aplicación mande el mensaje de rotación correspondiente.
export type LogEventReason = "size" | "inode";

export type LogEvent =
  | { kind: "line"; raw: string }
  | { kind: "rotation"; reason: LogEventReason };

export type LogEventHandler = (event: LogEvent) => Promise<void>;

export interface EventSourcePort {
  /** Arranca el tail. Resuelve cuando está listo; el bucle corre en 2.º plano. */
  start(onEvent: LogEventHandler): Promise<void>;
  /** Detiene el tail y cierra el fichero. */
  stop(): Promise<void>;
}
