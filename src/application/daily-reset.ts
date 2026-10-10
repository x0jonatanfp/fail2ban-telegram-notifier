// Caso de uso: reinicio diario del contador a medianoche local.
//
// El original (scheduled_tasks.py:10-45) sondeaba cada segundo y disparaba cuando
// `hour==minute==second==0`, lo que podía saltarse el reinicio si el bucle
// tardaba >1 s. Aquí se calcula el instante de la próxima medianoche y se
// programa un único temporizador, que se reprograma tras cada disparo.
import type { LoggerPort } from "../domain/ports/logger.ts";
import type { ResetCounterUseCase } from "./reset-counter.ts";
import { errText } from "./error-text.ts";

/** Próxima medianoche local estrictamente posterior a `from`. */
export function nextMidnight(from: Date): Date {
  const next = new Date(from.getTime());
  next.setHours(24, 0, 0, 0);
  return next;
}

export interface DailyResetDeps {
  resetCounter: ResetCounterUseCase;
  logger: LoggerPort;
  now: () => Date;
  /** Temporizador inyectable para poder testear sin esperar. */
  setTimer?: (callback: () => void, ms: number) => { unref?: () => void };
  clearTimer?: (handle: { unref?: () => void }) => void;
}

export class DailyResetScheduler {
  private handle: { unref?: () => void } | undefined;

  constructor(private readonly deps: DailyResetDeps) {}

  start(): void {
    this.schedule();
  }

  stop(): void {
    if (this.handle !== undefined) {
      const clear = this.deps.clearTimer ?? ((h: { unref?: () => void }) => clearTimeout(h as NodeJS.Timeout));
      clear(this.handle);
      this.handle = undefined;
    }
  }

  private schedule(): void {
    const now = this.deps.now();
    const ms = nextMidnight(now).getTime() - now.getTime();
    const set =
      this.deps.setTimer ?? ((cb: () => void, delay: number) => setTimeout(cb, delay));
    this.handle = set(() => {
      void this.run();
    }, ms);
    this.handle.unref?.();
    this.deps.logger.info("Reinicio diario programado.", {
      inMs: ms,
      at: nextMidnight(now).toISOString(),
    });
  }

  private async run(): Promise<void> {
    try {
      await this.deps.resetCounter.execute();
      this.deps.logger.info("Reinicio diario ejecutado.");
    } catch (error) {
      this.deps.logger.error("Error en el reinicio diario.", {
        error: errText(error),
      });
    } finally {
      this.schedule();
    }
  }
}
