# AGENTS.md · f2b

Guía para agentes de código. Qué es, cómo se instala y cómo se configura está en `README.md` (y `README.es.md`); la guía de contribución, en `CONTRIBUTING.md`.

## Qué es

Servicio TypeScript sobre Node.js que sigue el log de fail2ban y envía a Telegram los bloqueos, bloqueos permanentes y desbloqueos. Mantiene un contador (diario, reincidentes y total) con reinicio a medianoche local. Tiene dos transportes: Bot API directa (`TRANSPORT=direct`) y un tg-gateway local (`TRANSPORT=gateway`). **No tiene dependencias de ejecución**: solo Node y, para compilar, esbuild en desarrollo.

## Arquitectura

Hexagonal. `src/index.ts` es el único composition root: conoce `domain`, `application` e `infrastructure` a la vez. Exporta `createRuntime` para montarlo en tests y solo se arranca como programa principal.

- `src/domain/`: entidades (`fail2ban-event`, `counter-state`, `incoming-update`, `telegram-message`), puertos (`event-source`, `notifier`, `update-source`, `counter-store`, `logger`) y servicios puros (`parse-fail2ban-line.ts`, `batch-buffer.ts`, `batch-window.ts`, `batch-summary.ts`, `counter-rules.ts`, `message-format.ts`, `shutdown-suppressor.ts`, `format-time.ts`).
- `src/application/`: casos de uso. `notify-fail2ban-events.ts` (instantáneo o por lotes), `handle-command.ts`, `show-counter.ts`, `reset-counter.ts`, `daily-reset.ts`, `error-text.ts`.
- `src/infrastructure/`:
  - `fail2ban/tail-log-source.ts`: sigue el log; detecta rotación por tamaño e inodo.
  - `telegram/direct/`: `direct-notifier.ts` y `poller-update-source.ts` (long-polling).
  - `telegram/gateway/`: `gateway-notifier.ts` y `webhook-update-source.ts` (recibe lo reenviado por el gateway).
  - `telegram/normalize-update.ts`: normaliza updates de ambos transportes.
  - `persistence/`: `file-counter-store.ts` (por defecto) y `postgres-counter-store.ts` (opcional, requiere `pg`).
  - `config/env.ts`: `loadConfig()` valida todo al arrancar y lanza `ConfigError` con la lista de errores.
  - `logging/logger.ts`.

Flujo: `TailLogSource` → `NotifyFail2banEventsUseCase` → `NotifierPort` (transporte elegido). Los comandos entran por `UpdateSourcePort` → `HandleCommandUseCase`.

## Comandos

| Comando | Ejecuta |
| --- | --- |
| `pnpm install` | Instala dependencias de desarrollo. |
| `pnpm dev` | `node --watch` sobre `src/index.ts` (TypeScript directo, Node 22.18+). |
| `pnpm start` | Ejecuta `src/index.ts` una vez, sin compilar. |
| `pnpm build` | Bundle autocontenido con esbuild en `dist/index.js`. |
| `pnpm serve` | `node dist/index.js`. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm lint` | `eslint .`. |
| `pnpm test` / `test:watch` / `test:coverage` | Vitest. |
| `pnpm release` | `commit-and-tag-version` (versión, CHANGELOG y etiqueta). |

Antes de dar un cambio por bueno, según `CONTRIBUTING.md`: `pnpm typecheck && pnpm lint && pnpm test`.

## Cómo probar un cambio

- Tests en `tests/`, con Vitest. Config: `vitest.config.ts`, incluye `tests/**/*.test.ts`; la cobertura se mide sobre `src/**/*.ts`.
- Organización por capa: `tests/domain/`, `tests/application/`, `tests/infrastructure/`, `tests/e2e/`. Helpers en `tests/test/helpers.ts` (`createTestLogger`, `jsonResponse`, `makeTempDir`).
- Las pruebas de integración de HTTP levantan un servidor falso local en vez de tocar la Bot API. Mantén ese patrón.
- Un solo fichero: `pnpm vitest run tests/domain/parse-fail2ban-line.test.ts`. Filtrar: `pnpm vitest run -t "<texto>"`.
- Cada comportamiento nuevo o bug corregido lleva su test en el mismo cambio. Los bugs de lotes tienen tests de regresión en `tests/application/notify-instant-regression.test.ts` y `batch-notify.test.ts`: léelos antes de tocar `batch-*`.

## Convenciones

- Gestor: **pnpm** (`pnpm-lock.yaml`, `pnpm-workspace.yaml`).
- Imports con extensión `.ts` (`allowImportingTsExtensions`). Código y comentarios en inglés; las cadenas que ve el usuario están en `message-format.ts` con traducciones `es` y `en`.
- Estilo: `eslint.config.js`.
- Commits con Conventional Commits (`feat`, `fix`, `docs`, `chore`...), en el estilo del historial.
- Versión y `CHANGELOG.md`: los genera `commit-and-tag-version` (`.versionrc.json`) con `pnpm release`. **No se editan a mano.** `CONTRIBUTING.md` pide anotar cambios bajo `[Unreleased]`, lo que no encaja con este flujo: confírmalo antes de seguirlo.
- Configuración: `.env` (no versionado) a partir de `.env.example`. Sin `dotenv`: el proceso carga `.env` con el cargador nativo de Node si existe.

## Decisiones y trampas

- **Registro de comandos en el gateway.** `GATEWAY_COMMANDS` en `src/index.ts` es una lista fija: `/f2b`, `/chat_id`, `show_counter` y `not_touch`. **No añadas `/start` ni `/help`.** El gateway registra por coincidencia exacta y podría robar esos comandos a otro servicio. En `direct` sí se atienden, porque los gestiona el poller.
- **Desbloqueos falsos al parar fail2ban.** fail2ban emite una avalancha de `Unban` al apagarse. `F2B_SUPPRESS_SHUTDOWN_FLUSH` (true por defecto) lo suprime con `shutdown-suppressor.ts`.
- **Modo lote.** Las ventanas se alinean al reloj local, y `BATCH_WINDOW_SEC` debe dividir 86400. `NOTIFY_INSTANT_JAILS` salta el lote y **no** se cuenta en el resumen. `NOTIFY_UNBANS=list` solo añade IPs con `BATCH_SHOW_IPS=true`.
- **Contador.** Por defecto es un JSON en `./data/` (`COUNTER_FILE`), sin base de datos. `COUNTER_BACKEND=postgres` requiere el paquete opcional `pg`; si falta el paquete, no hay verificación de que el arranque lo detecte (no lo he comprobado).
- **Reinicio diario.** `daily-reset.ts` reinicia el contador a medianoche local. El orden del resumen con el reinicio diario tiene commits propios (`c6e4081`, `44f6dde`); lee el historial antes de tocarlo.
- **Rotación del log.** `tail-log-source` detecta la rotación por tamaño y por inodo. Si cambias la lectura, prueba ambos casos.
- **Error de configuración = salida.** Un valor inválido sale con la lista de errores; no arranca a medias.
- **Ejemplo de unidad.** `deploy/f2b.service.example` es una plantilla (usuario y rutas de ejemplo). Adáptala en el entorno de despliegue; no la copies con los valores de ejemplo.

## Mantenimiento

- Este fichero y el `README.md` se actualizan en el mismo cambio que los deja obsoletos.
- Aquí solo va lo que puede ser público: nada de rutas locales, puertos de la máquina, IPs, perfiles de secretos ni datos personales.
