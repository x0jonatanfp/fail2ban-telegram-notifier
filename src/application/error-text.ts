// Utilidad compartida por los casos de uso para extraer un mensaje legible de un
// error desconocido, sin exponer el objeto completo en los logs.
export function errText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
