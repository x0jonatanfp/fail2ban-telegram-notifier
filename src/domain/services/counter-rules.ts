// Servicio de dominio puro: reglas del contador.
//
// Semántica replicada del bot original:
//   - Ban de una jail normal:   `daily += 1`, `last = ahora`.
//   - Ban de una jail permanente (p. ej. `recidive`): `permanent += 1`,
//     `last = ahora`.  (El original también actualiza `last` aquí: ver f2b.py:105,111.)
//   - Unban: no toca el contador.
//   - Reset (medianoche o botón "no tocar"): `total += daily`, `daily = 0`,
//     `last = ahora`. `permanent` no se reinicia.
import type { CounterState } from "../entities/counter-state.ts";

/** Aplica un ban (normal o permanente) y devuelve el nuevo estado. */
export function applyBan(
  state: CounterState,
  jail: string,
  permanentJails: ReadonlySet<string>,
  at: string,
): CounterState {
  if (permanentJails.has(jail)) {
    return { ...state, permanent: state.permanent + 1, last: at };
  }
  return { ...state, daily: state.daily + 1, last: at };
}

/** Aplica el reinicio del contador diario. */
export function applyReset(state: CounterState, at: string): CounterState {
  return {
    daily: 0,
    permanent: state.permanent,
    total: state.total + state.daily,
    last: at,
  };
}
