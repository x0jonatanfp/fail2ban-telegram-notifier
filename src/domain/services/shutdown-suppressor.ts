// Servicio de dominio puro: máquina de estados que suprime los "Unban"
// masivos que fail2ban emite al apagarse/reiniciarse.
//
// Paridad con el bot original (f2b.py:24-26,66-81): el flag `flush_mode` se
// activa al ver un marcador de apagado y se desactiva al ver un marcador de
// arranque o cualquier `Ban` real. Mientras está activo, los `Unban` se
// ignoran.
//
// No hace I/O: solo mantiene estado en memoria. Es puro en el sentido de que su
// salida depende únicamente de la secuencia de líneas observadas.
export const SHUTDOWN_MARKERS = [
  "Shutdown in progress",
  "Stopping all jails",
] as const;

export const STARTUP_MARKERS = ["Starting Fail2ban"] as const;

export type SuppressorMarker = "shutdown" | "startup";

export class ShutdownSuppressor {
  private suppressing = false;

  /**
   * Observa una línea y actualiza el estado si contiene un marcador.
   * Devuelve el tipo de marcador encontrado, o null si la línea es neutra.
   * Orden importante: primero apagado, luego arranque (igual que el original).
   */
  observeMarker(line: string): SuppressorMarker | null {
    if (SHUTDOWN_MARKERS.some((marker) => line.includes(marker))) {
      this.suppressing = true;
      return "shutdown";
    }
    if (STARTUP_MARKERS.some((marker) => line.includes(marker))) {
      this.suppressing = false;
      return "startup";
    }
    return null;
  }

  /** Reactiva los avisos (se llama ante cualquier `Ban` real). */
  reactivate(): void {
    this.suppressing = false;
  }

  /** ¿Se están suprimiendo los unbans en este momento? */
  isSuppressing(): boolean {
    return this.suppressing;
  }
}
