// Servicio de dominio puro: reglas del contador.
//
// Semántica replicada del bot original:
//   - Ban de una jail normal:   `daily += 1`, `last = ahora`.
//   - Ban de una jail de reincidentes (p. ej. `recidive`): `repeatOffenders += 1`,
//     `last = ahora`.  (El original también actualiza `last` aquí: ver f2b.py:105,111.)
//   - Unban: no toca el contador.
//   - Reset (medianoche o botón "no tocar"): `total += daily`, `daily = 0`,
//     `last = ahora`. `repeatOffenders` no se reinicia.
import type { CounterState } from "../entities/counter-state.ts";

/** Aplica un ban (normal o de reincidente) y devuelve el nuevo estado. */
export function applyBan(
  state: CounterState,
  jail: string,
  repeatOffenderJails: ReadonlySet<string>,
  at: string,
): CounterState {
  if (repeatOffenderJails.has(jail)) {
    return { ...state, repeatOffenders: state.repeatOffenders + 1, last: at };
  }
  return { ...state, daily: state.daily + 1, last: at };
}

/** Aplica el reinicio del contador diario. */
export function applyReset(state: CounterState, at: string): CounterState {
  return {
    daily: 0,
    repeatOffenders: state.repeatOffenders,
    total: state.total + state.daily,
    last: at,
  };
}
