// Servicio de dominio puro: parseo de una línea de `fail2ban.log`.
//
// Réplica EXACTA del comportamiento del bot Python (f2b.py:18,71):
//   - el patrón es `\[(?P<jail>[^\]]+)\]\s+(?P<action>\w+)\s+(?P<ip>[0-9\.]+)`
//     y se aplica con semántica de búsqueda (`re.search`), no de anclaje: por
//     eso casa a partir del `[sshd]` aunque antes haya un `[pid]`.
//   - solo se procesan líneas que contienen `"fail2ban.actions"`.
//   - la clase de IP es solo dígitos y puntos: NO soporta IPv6 ni `ip:puerto`
//     (igual que el original; se documenta).
//
// `\w` en JavaScript es `[A-Za-z0-9_]` (ASCII), suficiente para las acciones de
// fail2ban. El resultado conserva la acción tal cual ("Ban", "Unban", "Found"…);
// filtrar qué acciones generan notificación es responsabilidad de la aplicación.
import type { Fail2banLogEntry } from "../entities/fail2ban-event.ts";

const ACTIONS_MARKER = "fail2ban.actions";

const LINE_PATTERN = /\[([^\]]+)\]\s+(\w+)\s+([0-9.]+)/;

export function parseFail2banLine(line: string): Fail2banLogEntry | null {
  if (!line.includes(ACTIONS_MARKER)) return null;

  const match = LINE_PATTERN.exec(line);
  if (match === null) return null;

  const jail = match[1];
  const action = match[2];
  const ip = match[3];
  // `noUncheckedIndexedAccess` obliga a comprobar; el regex ya garantiza que
  // existen cuando `match !== null`.
  if (jail === undefined || action === undefined || ip === undefined) return null;

  return { jail, action, ip };
}
