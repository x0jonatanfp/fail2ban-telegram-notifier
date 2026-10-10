// Servicio de dominio puro: formatea una hora local como "HH:MM:SS".
// Réplica de helpers.format_datetime (helpers.py:53-55, `strftime("%H:%M:%S")`).
export function formatLocalTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}
