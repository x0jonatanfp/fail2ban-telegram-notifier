// Entidad de dominio pura: acumula los eventos del lote en memoria.
//
// Sin I/O: solo guarda bans/unbans hasta el flush. El tope anti-crecimiento
// se aplica aquí (descarta los más antiguos) para que un fallo de envío
// reiterado no consuma memoria sin límite.
import type { BatchRecordedEvent } from "./batch-summary.ts";

/** Tope del buffer en modo batch (eventos totales entre bans y unbans). */
// Porqué 5000: una ventana típica acumula decenas; 5000 retiene ~un día de
// tormenta sin crecer sin límite si Telegram falla de forma sostenida.
export const MAX_BATCH_BUFFER_EVENTS = 5000;

export class BatchBuffer {
  private readonly bans: BatchRecordedEvent[] = [];
  private readonly unbans: BatchRecordedEvent[] = [];
  private dropped = 0;

  addBan(ip: string, jail: string): void {
    this.bans.push({ ip, jail });
    this.enforceCap();
  }

  addUnban(ip: string, jail: string): void {
    this.unbans.push({ ip, jail });
    this.enforceCap();
  }

  get banCount(): number {
    return this.bans.length;
  }

  get unbanCount(): number {
    return this.unbans.length;
  }

  get size(): number {
    return this.bans.length + this.unbans.length;
  }

  get isEmpty(): boolean {
    return this.bans.length === 0 && this.unbans.length === 0;
  }

  /** Eventos pendientes para el reintento (cuántos se descartaron por tope). */
  get droppedCount(): number {
    return this.dropped;
  }

  snapshot(): { bans: BatchRecordedEvent[]; unbans: BatchRecordedEvent[] } {
    return {
      bans: [...this.bans],
      unbans: [...this.unbans],
    };
  }

  clear(): void {
    this.bans.length = 0;
    this.unbans.length = 0;
  }

  private enforceCap(): void {
    while (this.size > MAX_BATCH_BUFFER_EVENTS) {
      // Descarta lo más antiguo: primero unbans (menos valiosos), luego bans.
      if (this.unbans.length > 0) this.unbans.shift();
      else this.bans.shift();
      this.dropped += 1;
    }
  }
}
