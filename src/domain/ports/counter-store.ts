// Puerto `CounterStorePort`: persistencia del contador.
// Adaptadores: `file-counter-store` (JSON, por defecto) y
// `postgres-counter-store` (opcional, import dinámico de `pg`).
import type { CounterState } from "../entities/counter-state.ts";

export interface CounterStorePort {
  load(): Promise<CounterState>;
  save(state: CounterState): Promise<void>;
}
