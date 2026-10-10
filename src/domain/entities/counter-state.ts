// Entidad de dominio: estado del contador de bloqueos.
// Nombres internos: `daily`, `permanent`, `total`. La semántica replica al bot
// original (donde eran `count`, `weekly`, `total_bans`): `daily` son los bans no
// reincidentes del día, `permanent` cuenta los bans de jails "permanentes"
// (p. ej. `recidive`) y `total` acumula `daily` en cada reinicio.
export interface CounterState {
  /** Bans no reincidentes contabilizados desde el último reinicio. */
  daily: number;
  /** Bans de jails marcadas como permanentes (p. ej. `recidive`). */
  permanent: number;
  /** Acumulado histórico de `daily` a través de los reinicios. */
  total: number;
  /** Hora local del último evento que tocó el contador, "HH:MM:SS", o null. */
  last: string | null;
}

/** Estado inicial del contador (sin eventos registrados). */
export function emptyCounterState(): CounterState {
  return { daily: 0, permanent: 0, total: 0, last: null };
}
