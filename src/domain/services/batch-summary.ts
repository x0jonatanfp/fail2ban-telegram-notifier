// Servicio de dominio puro: agrega eventos del lote y formatea el resumen.
//
// Una sola línea por mensaje (sin `\n`): los bloques se unen con ` · `.
// Jails ordenadas de mayor a menor recuento, empates por nombre (comparación
// por unidades de código para un orden determinista). Más de 8 jails ⇒ el
// resto se pliega en `otras N` / `other N` (N = suma de bans plegados).
import type { MessageTemplates } from "./message-format.ts";
import { formatLocalHourMinute } from "./format-time.ts";

export interface BatchRecordedEvent {
  ip: string;
  jail: string;
}

export type NotifyUnbansMode = "count" | "off" | "list";

export interface BatchSummaryData {
  windowStart: Date;
  windowEnd: Date;
  bans: BatchRecordedEvent[];
  unbans: BatchRecordedEvent[];
  showIps: boolean;
  unbanMode: NotifyUnbansMode;
}

/** Límite de Telegram para un mensaje de texto. */
export const TELEGRAM_MAX_MESSAGE_LEN = 4096;

/** Jails con detalle propio; el resto se pliega en `otras N`. */
export const MAX_JAILS_SHOWN = 8;

interface JailGroup {
  jail: string;
  ips: string[];
}

function groupByJail(events: BatchRecordedEvent[]): JailGroup[] {
  const byJail = new Map<string, string[]>();
  for (const event of events) {
    const list = byJail.get(event.jail);
    if (list === undefined) byJail.set(event.jail, [event.ip]);
    else list.push(event.ip);
  }
  const groups = [...byJail.entries()].map(([jail, ips]) => ({ jail, ips }));
  // Mayor recuento primero; empates por nombre.
  groups.sort((a, b) => b.ips.length - a.ips.length || (a.jail < b.jail ? -1 : a.jail > b.jail ? 1 : 0));
  return groups;
}

/** Parte un bloque `jail (n): ip, ip, …` por IPs sin cortar etiquetas HTML. */
function splitJailBlock(block: string, jail: string, count: number, spoilerIps: string[], messages: MessageTemplates): string[] {
  if (block.length <= TELEGRAM_MAX_MESSAGE_LEN) return [block];
  const parts: string[] = [];
  let current: string[] = [];
  // Porqué se reusa la etiqueta completa: cada trozo debe identificar su jail.
  const prefixLen = messages.batchJailIps(jail, count, "").length;
  let currentLen = prefixLen;
  for (const spoiler of spoilerIps) {
    const extra = (current.length === 0 ? 0 : 2) + spoiler.length;
    if (current.length > 0 && currentLen + extra > TELEGRAM_MAX_MESSAGE_LEN) {
      parts.push(messages.batchJailIps(jail, count, current.join(", ")));
      current = [];
      currentLen = prefixLen;
    }
    current.push(spoiler);
    currentLen += current.length === 1 ? spoiler.length : extra;
  }
  if (current.length > 0) parts.push(messages.batchJailIps(jail, count, current.join(", ")));
  // Caso extremo: una sola IP + etiqueta ya supera 4096 (IP absurda); se
  // devuelve igual para no perder el evento (Telegram lo rechazará y se
  // registrará el error en el caso de uso).
  if (parts.length === 0) return [block];
  return parts;
}

/**
 * Formatea el resumen del lote. Devuelve 0..N mensajes de una sola línea
 * (cada uno ≤ 4096). Vacío ⇒ no enviar nada (ventana sin eventos visibles).
 */
export function formatBatchSummary(data: BatchSummaryData, messages: MessageTemplates): string[] {
  const banGroups = groupByJail(data.bans);
  const unbanGroups = groupByJail(data.unbans);
  const showUnbans = data.unbanMode !== "off" && data.unbans.length > 0;
  if (banGroups.length === 0 && !showUnbans) return [];

  const blocks: string[] = [];
  blocks.push(
    messages.batchTitle(
      formatLocalHourMinute(data.windowStart),
      formatLocalHourMinute(data.windowEnd),
    ),
  );

  if (banGroups.length > 0) {
    const total = data.bans.length;
    if (!data.showIps) {
      const shown = banGroups.slice(0, MAX_JAILS_SHOWN);
      const folded = banGroups.slice(MAX_JAILS_SHOWN);
      const entries = shown.map((g) => messages.batchJailCount(g.jail, g.ips.length));
      if (folded.length > 0) {
        const foldedTotal = folded.reduce((acc, g) => acc + g.ips.length, 0);
        entries.push(messages.batchOther(foldedTotal));
      }
      blocks.push(messages.batchBans(total, entries.join(", ")));
    } else {
      blocks.push(messages.batchBans(total, ""));
      const shown = banGroups.slice(0, MAX_JAILS_SHOWN);
      const folded = banGroups.slice(MAX_JAILS_SHOWN);
      for (const group of shown) {
        const spoilerIps = group.ips.map((ip) => messages.batchSpoilerIp(ip));
        const block = messages.batchJailIps(group.jail, group.ips.length, spoilerIps.join(", "));
        for (const part of splitJailBlock(block, group.jail, group.ips.length, spoilerIps, messages)) {
          blocks.push(part);
        }
      }
      if (folded.length > 0) {
        const foldedTotal = folded.reduce((acc, g) => acc + g.ips.length, 0);
        blocks.push(messages.batchOther(foldedTotal));
      }
    }
  }

  if (showUnbans) {
    blocks.push(messages.batchUnbans(data.unbans.length));
    if (data.unbanMode === "list" && data.showIps) {
      const shown = unbanGroups.slice(0, MAX_JAILS_SHOWN);
      const folded = unbanGroups.slice(MAX_JAILS_SHOWN);
      for (const group of shown) {
        const spoilerIps = group.ips.map((ip) => messages.batchSpoilerIp(ip));
        const block = messages.batchJailIps(group.jail, group.ips.length, spoilerIps.join(", "));
        for (const part of splitJailBlock(block, group.jail, group.ips.length, spoilerIps, messages)) {
          blocks.push(part);
        }
      }
      if (folded.length > 0) {
        const foldedTotal = folded.reduce((acc, g) => acc + g.ips.length, 0);
        blocks.push(messages.batchOther(foldedTotal));
      }
    }
  }

  // Empaquetado voraz por bloques ` · ` completos; la cabecera solo va en el
  // primer mensaje y el resto continúa con los bloques restantes.
  const separator = " · ";
  const out: string[] = [];
  let current = "";
  for (const block of blocks) {
    // Un bloque solo ya > 4096 solo ocurre con splitJailBlock, que ya troceó.
    const candidate = current === "" ? block : `${current}${separator}${block}`;
    if (candidate.length <= TELEGRAM_MAX_MESSAGE_LEN) {
      current = candidate;
    } else if (current === "") {
      current = block;
    } else {
      out.push(current);
      current = block;
    }
  }
  if (current !== "") out.push(current);
  return out;
}
