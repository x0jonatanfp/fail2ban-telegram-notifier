// Servicio de dominio puro: ventanas del modo batch alineadas al reloj local.
//
// Las ventanas se alinean a la medianoche local (igual que el reinicio diario):
// con 3600 s salen a las :00; con 900 s a :00/:15/:30/:45. Requiere que
// `windowSec` divida a 86400 (validado en `env.ts`); si no, el reparto sería
// irregular entre días.
export interface BatchWindow {
  start: Date;
  end: Date;
}

/** Ventana alineada que contiene a `now`. `end` puede caer al día siguiente. */
export function windowFor(now: Date, windowSec: number): BatchWindow {
  const midnight = new Date(now.getTime());
  midnight.setHours(0, 0, 0, 0);
  const windowMs = windowSec * 1000;
  const elapsed = now.getTime() - midnight.getTime();
  // En días de cambio horario `elapsed` puede ser negativo o > 24 h; se
  // pinza al día local para no devolver ventanas absurdas.
  const clamped = Math.min(Math.max(elapsed, 0), 86400 * 1000);
  const index = Math.min(Math.floor(clamped / windowMs), Math.ceil(86400 / windowSec) - 1);
  const start = new Date(midnight.getTime() + index * windowMs);
  return { start, end: new Date(start.getTime() + windowMs) };
}

/** Milisegundos hasta el fin de la ventana actual (para programar el flush). */
export function msUntilWindowEnd(now: Date, windowSec: number): number {
  return Math.max(windowFor(now, windowSec).end.getTime() - now.getTime(), 0);
}
