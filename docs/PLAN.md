# Fase A — Auditoría del bot actual + plan de migración a TypeScript

Este documento es el entregable de la **Fase A**: auditoría del bot Python actual
(`f2b_private_bot`) y plan para reescribirlo en TypeScript. **No contiene código.**

- **Origen auditado (solo lectura):** el repo privado `f2b_private_bot`
  (repo git, 16 commits; commit HEAD `f95a5fd`).
- **Contrato real del gateway:** el repo local `tg-gateway`
  (código TS, no inventado).
- **Referencias de estilo/estructura:** `tg-gateway` y `mail-relay`.
- **Destino (este directorio):** `f2b/` — nace vacío.

> **Convención de citas:** todas las rutas `fichero:línea` son **relativas a
> `f2b_private_bot/`**. Se citan líneas reales leídas del repo y de `git log`.

---

## 1. Inventario funcional exacto

### 1.1 Arranque y composition root

`main.py` es el punto de entrada. `main()` (main.py:86-118) monta un servidor
webhook con aiohttp, registra handlers en el gateway, y lanza dos tareas de fondo:

- `read_log` — tail del log de fail2ban (main.py:98).
- `scheduled_tasks` — reset diario del contador (main.py:99).

Al arrancar: `CHAT_ID` es obligatorio, si vale `0` el proceso muere con
`SystemExit("Variables de entorno faltantes: CHAT_ID")` (main.py:19, 23-24).
No hay validación del token porque el bot **no habla con Telegram directamente**:
usa el gateway (main.py:20, 26).

### 1.2 Ingesta de updates (transporte actual: gateway)

El bot **no hace polling**. Levanta un HTTP local en `127.0.0.1:WEBHOOK_PORT`
(`14120` por defecto) con la ruta `POST /tg-update` (main.py:88, 92) y registra
cuatro handlers en el gateway vía `POST /api/register-handler` (main.py:29-48):

| comando registrado | webhook | cita |
|---|---|---|
| `/f2b` | `http://localhost:14120/tg-update` | main.py:31 |
| `/chat_id` | idem | main.py:32 |
| `show_counter` | idem | main.py:33 |
| `not_touch` | idem | main.py:34 |

`handle_tg_update` (main.py:51-83) recibe el update crudo de Telegram, y ramifica:

- `callback_query` con `data == "show_counter"` → `handle_show_counter` (main.py:59-60).
- `data == "not_touch"` → `handle_do_not_touch` (main.py:61-62).
- texto que empieza por `/f2b` → `handle_f2b`; `/chat_id` → `handle_chat_id`;
  `/start`; `/help` (main.py:65-78).

**Hallazgos:**
- `/start` y `/help` están implementados (main.py:70-78) pero **no se registran
  como handlers** en el gateway (main.py:30-35), así que el gateway nunca los
  enruta y son **código muerto**. No hay handler `__default__`.
- Los botones de los contadores usan `callback_data = "noop"` (f2b.py:166-169,
  194-196); `noop` no está registrado → al pulsarlos el gateway no encuentra
  handler y los descarta (no pasa nada).
- El registro solo ocurre al arrancar (main.py:96). Si el gateway reinicia, el
  registro en memoria se pierde (`handler-registry.ts` no persiste) y **el bot no
  se re-registra**; los comandos dejan de responder hasta reiniciar el bot.

### 1.3 Detección de eventos de fail2ban

Es **tail por lectura de fichero** (no journal, no action de fail2ban, no
`fail2ban-client`). `read_log` (f2b.py:27-98):

- Abre `FAIL2BAN_LOG_PATH` (`/var/log/fail2ban.log` por defecto, f2b.py:16) y hace
  `seek(0, 2)` → **solo lee líneas nuevas**, no reprocesa histórico (f2b.py:33).
- Guarda `inode` y `size` iniciales (f2b.py:34-35).
- **Rotación por tamaño:** si `current_size < last_size`, avisa por Telegram y
  reabre (f2b.py:38-42).
- **Rotación por inode** (p. ej. `logrotate` con `create`): si el inode cambia,
  avisa y reabre (f2b.py:44-48).
- Sin línea disponible: `seek` atrás y `sleep(1)` (f2b.py:52-54).
- Solo procesa líneas que contienen `"fail2ban.actions"` (f2b.py:71).

Parser por regex (f2b.py:18):

```
\[(?P<jail>[^\]]+)\]\s+(?P<action>\w+)\s+(?P<ip>[0-9\.]+)
```

Es decir `[jail] Action IP`. `search` recorre la línea, por lo que salta el
`[pid]` y casa `[jail] Ban 1.2.3.4` (f2b.py:72-76). **Limitaciones reales:** la IP
solo admite dígitos y puntos → **no soporta IPv6** ni sufijos `:puerto`; `action`
es `\w+` pero solo se actúa sobre `Ban` y `Unban` (f2b.py:78-88); `Found`,
`Restore Ban`, etc. se ignoran.

**Eventos notificados:**
- `Ban` → `_send_ban` (f2b.py:78-80, 101-120).
- `Unban` → `_send_unban` salvo supresión (f2b.py:81-88, 123-130).
- Avisos de rotación de log (f2b.py:41, 47).

No hay deduplicación de eventos. No hay distinción IPv4/IPv6.

### 1.4 Supresión de unbans falsos al parar fail2ban (lógica clave)

Introducida en el commit `29832b9` («no avisa de los unbans falsos al parar
fail2ban»). Al reiniciar/apagar, fail2ban vacía las jails y emite un `Unban` por
cada IP activa; eso no es un desbaneo real. La detección usa un flag en memoria
`flush_mode` (f2b.py:29):

1. Marcadores de apagado `SHUTDOWN_MARKERS = ("Shutdown in progress",
   "Stopping all jails")` (f2b.py:23). Si la línea los contiene → `flush_mode = True`
   y `continue` (f2b.py:60-65).
2. Marcadores de arranque `STARTUP_MARKERS = ("Starting Fail2ban",)` (f2b.py:24).
   Si la línea los contiene → `flush_mode = False` y `continue` (f2b.py:67-69).
3. Un `Ban` real también resetea `flush_mode = False` (f2b.py:79) — así, si tras el
   apagado no se vio el marcador de arranque, el primer ban legítimo reactiva los avisos.
4. `Unban` con `flush_mode == True` → se **suprime** (solo log, no Telegram)
   (f2b.py:82-88); en caso contrario se notifica (f2b.py:88).

**Precisión / casos límite:**
- El estado vive **solo en memoria** y solo se activa si la línea de shutdown se
  lee del tail; si el bot arranca después del shutdown no lo detecta.
- Tras un shutdown, un `Unban` **legítimo** anterior a cualquier `Ban` o al
  marcador de arranque se silencia.
- Un `kill -9` de fail2ban (sin sus marcadores) no activa la supresión.

### 1.5 Formato EXACTO de los mensajes

Parse mode HTML en todos los envíos (gateway_client.py:22). Textos exactos:

**Ban normal** (f2b.py:114-116):
```
🔒 IP <span class="tg-spoiler">{ip}</span> ha sido <b>bloqueada</b> por <b><i>{jail}</i></b>.
```

**Ban de jail `recidive`** (bloqueo permanente; f2b.py:107-110):
```
🚫 IP <span class="tg-spoiler">{ip}</span> ha sido bloqueada permanentemente por <i>{jail}</i>.
```

**Unban** (f2b.py:125-127):
```
🌐 IP <span class="tg-spoiler">{ip}</span> ha sido <b>desbloqueada</b> por <i>{jail}</i>.
```

**Avisos de rotación** (f2b.py:41, 47):
```
<b>🔄 Rotación de log detectada, reabriendo...</b>
<b>📂 Reemplazo de log detectado, reabriendo...</b>
```

**Comando `/f2b`** (f2b.py:133-155): envía `🛠️ <b>Configuración F2B</b>` con teclado
inline de dos botones (`show_counter` = «📊 ¡Mostrar valores!», `not_touch` =
«⚠️ ¡No tocar!»), borra el mensaje del usuario y el del bot a los 6 s cada uno
(dos `sleep(6)` secuenciales, f2b.py:146-155).

**Callback `show_counter`** (f2b.py:158-179): responde el callback y envía
`<b>📊 CONTADOR DE BLOQUEOS</b>` con 4 filas:
`📈 Diarios: {count}`, `🚫 Reincidentes: {weekly}`, `🔒 Totales: {total_bans}`,
`⏲️ Última acción: {last}`; borra el mensaje a los 6 s (f2b.py:176-179).

**Callback `not_touch`** y **reset diario** (f2b.py:182-200, scheduled_tasks.py:32-39):
`<b>🔄 ¡CONTADOR REINICIADO!</b>` con 3 filas (Diarios, Reincidentes, Totales).

**Comando `/chat_id`** (user.py:8-27): bloque con User ID / Chat ID / (ID de tema
si `message_thread_id` está presente), ambos IDs en `tg-spoiler`, cierra con
`🔍 <b>¡Guárdalo de forma segura!</b> 🔒`.

**`/start` y `/help`** (main.py:70-78), hoy muertos: `Hola. Usa /chat_id o /f2b.`
y una lista de comandos con `<b>🛠️ <b>Comandos:</b>`.

### 1.6 Contadores y estado persistente

El **único estado persistente** es el contador en PostgreSQL, tabla `f2b_stats`
(`id, count, last, total_bans, weekly`; helpers.py:19-28, 91). Semántica real
(comprobada en el código, no en los nombres):

| Evento | `count` (Diarios) | `weekly` (Reincidentes) | `total_bans` (Totales) | `last` |
|---|---|---|---|---|
| Ban normal | +1 | = | = | ahora |
| Ban `recidive` | = | +1 | = | ahora |
| Unban | = | = | = | = |
| Reset (00:00 o `not_touch`) | →0 | = | += count | ahora |

> **Corrección (Fase B):** el `Ban recidive` **sí** actualiza `last` a la hora
> actual. El bot original llama `update_counter(count, formatted_last,
> total_bans, weekly + 1)` con `formatted_last = format_datetime(now)`
> (f2b.py:105, 111), es decir, el mismo `last` que el ban normal. La tabla de la
> Fase A marcaba `=`, lo cual era un error; la implementación reproduce el
> comportamiento real del código.

- `count` = bloqueos del día (no-recidive) (f2b.py:117).
- `weekly` cuenta en realidad **bans de la jail `recidive`** («permanentes»), no
  semanales (f2b.py:111).
- `total_bans` **acumula** `count` en cada reset, no cuenta cada ban (f2b.py:188,
  scheduled_tasks.py:27).
- `last` es solo hora `HH:MM:SS` (columna `TIME WITHOUT TIME ZONE`; helpers.py:55,
  98; README.md:111-113).

Persistencia (helpers.py):
- Pool asyncpg perezoso `min=1, max=5, timeout=5s` (helpers.py:16, 25-27, 58-68).
- `load_counter` lee la fila más reciente `ORDER BY id DESC LIMIT 1`; si falla la
  BD devuelve `(0, None, 0, 0)` (helpers.py:81-104).
- `update_counter` es atómico con `SELECT ... FOR UPDATE` y hace `UPDATE` o
  `INSERT` (helpers.py:135-170).
- `save_counter` inserta fila nueva; **no se usa** (solo lo referencia el docstring)
  (helpers.py:108-131).
- Reset diario: bucle que comprueba `hour==0 and minute==0 and second==0` y evita
  repetir con `last_reset_date` (scheduled_tasks.py:11-23). Puede perderse el
  segundo exacto si el bucle va cargado.

### 1.7 Concurrencia, límites, reintentos y señales

- **Reintentos: ninguno** en el bot. `GatewayClient` hace un único POST por método
  (gateway_client.py:29-31, 34-38, 41-45, 48-55) y abre/cierra un `ClientSession`
  distinto en cada llamada (sin keep-alive, sin timeout explícito).
- **Límite de ritmo: ninguno** en el bot. El gateway sí aplica `TG_MIN_INTERVAL_MS`
  (1200 ms por defecto) y tiene circuit breaker (`tg-gateway/.env.example:17,55-81`).
- **Deduplicación: ninguna.**
- **Señales:** `SIGINT`/`SIGTERM` → `stop_event` (main.py:101-109); cancela las dos
  tareas, `gather`, `remove_pycache`, `close_pool` y `runner.cleanup`
  (main.py:111-118). **No** desregistra handlers del gateway.
- **Errores de BD se tragan** y el bot sigue (helpers.py:83-86, 102-104).

---

## 2. Inventario de configuración (el bot actual)

Fuente: lectura directa de defaults + `.env.example`. `API_TOKEN` existe en
`.env.example:2` pero **no lo usa ningún `.py`** (el token lo tiene el gateway).

| Variable | Default en código | Dónde | ¿Documentada en `.env.example`? |
|---|---|---|---|
| `CHAT_ID` | `0` (obligatorio, si 0 aborta) | main.py:19, 23-24 | sí (.env.example:3) |
| `TG_GATEWAY_URL` | `http://localhost:4000` | main.py:20 | **no** |
| `WEBHOOK_PORT` | `14120` | main.py:21 | **no** |
| `TOPIC_ID` | `None` | gateway_client.py:12, helpers.py:45 | sí (.env.example:4) |
| `API_TOKEN` | — (sin uso) | — | sí (.env.example:2) |
| `FAIL2BAN_LOG_PATH` | `/var/log/fail2ban.log` | f2b.py:16 | sí (.env.example:15) |
| `DB_HOST` | `localhost` | helpers.py:20 | sí |
| `DB_PORT` | `5432` | helpers.py:21 | sí |
| `DB_NAME` | `telegramBot` | helpers.py:22 | sí |
| `DB_USER` | `tlb` | helpers.py:23 | sí |
| `DB_PASSWORD` | `""` | helpers.py:24 | sí |
| `LOG_FILE` | `/var/log/f2b.log` | logging_config.py:12 | sí (.env.example:16) |
| `LOGGER_NAME` | `f2b_private_bot` | logging_config.py:13 | sí (.env.example:14) |

`validate_env_vars` exige `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` presentes
(helpers.py:32-40) — aunque sus defaults existen, sin `.env` la BD falla.

**Unit systemd actual** (`deploy/f2b_private_bot.service`): unidad de sistema,
`User` con el usuario del autor (línea 10), `WorkingDirectory` con la ruta del autor
(12), `Environment=LOG_FILE=/var/log/f2b.log` (15) y `ExecStart` a través de un
lanzador privado del autor (17). **Datos privados que no deben publicarse.**

**Logging** (logging_config.py:16-41): `WatchedFileHandler(LOG_FILE)` + `StreamHandler`
(stderr → journal), nivel `INFO`; si el fichero no abre, arranca solo con stderr
(logging_config.py:26-32).

---

## 3. Qué necesita el bot para ser genérico y publicable

Todo lo siguiente está **hoy hardcodeado o asumido** y debe pasar a configuración:

1. **Rutas del autor**: `WorkingDirectory` con la ruta del autor y un lanzador
   privado (deploy/f2b_private_bot.service:12,17).
2. **Jail `recidive`** como “permanente” (f2b.py:107) → debe ser configurable
   (`F2B_PERMANENT_JAILS`, p. ej. `recidive` por defecto).
3. **Ruta del log** `/var/log/fail2ban.log` (configurable ya, pero documentar).
4. **Chat/tema/token**: `CHAT_ID`/`TOPIC_ID` ya son env; el token hoy vive en el
   gateway; en modo `direct` deberá ser env propio.
5. **Idioma de los mensajes**: español fijo (f2b.py:108-126) → configurable.
6. **Base de datos**: hoy Postgres obligatorio con nombre/usuario por defecto
   “tlb/telegramBot” (helpers.py:22-23); para “instalar desde fuente” conviene un
   backend sin dependencias externas o hacer la BD opcional.
7. **`message_thread_id`** (topic) se manda pero el gateway lo ignora (ver §9) →
   documentar/soportar según transporte.
8. **Marca**: el nombre `f2b_private_bot`, badges `aiogram` en README.md:7 (obsoleto,
   ya no usa aiogram) y las funcionalidades fantasma (Home Assistant `/status`,
   `/love`, `/kids`, y limpieza MEGA) que **no existen en el código**
   (README.md:38-44, 25; mega-cleanup.md describe algo ya eliminado).
9. `README.MD` (mayúsculas) y `README.md` coexisten → limpiar a un único README.

---

## 4. Decisiones de la migración (APROBADAS)

Todas quedan **cerradas según la recomendación** de la Fase A, con los matices
acordados. **La arquitectura hexagonal (decisión 15) es obligatoria.**

| # | Decisión | Elegida |
|---|---|---|
| 1 | Persistencia del contador | Puerto `CounterStore`; por defecto adaptador **archivo JSON**. **Postgres opcional**, cargado solo con `COUNTER_BACKEND=postgres` mediante **import dinámico**; la instalación por defecto **no requiere** `pg`. |
| 2 | Detección de eventos | **Tail de fichero con rotación** (paridad exacta: detección por tamaño y por inode). |
| 3 | Transporte por defecto | **`direct`** (Bot API). `gateway` disponible por entorno. |
| 4 | Temas (`message_thread_id`) | Soportado en `direct`. En `gateway` se **documenta la limitación** (su `/api/send` lo ignora); **no se toca `tg-gateway`**. |
| 5 | Gestor de paquetes | **pnpm**. |
| 6 | Extensión en imports | **`.ts` explícita** + build con **esbuild**. |
| 7 | Idioma de mensajes | i18n **`es`/`en`**, con `MESSAGE_LANG=es` por defecto (paridad). El README en inglés usará `MESSAGE_LANG=en` en sus ejemplos. |
| 8 | Semántica de contadores | **Paridad** (`daily`/`permanent`/`total` internamente, documentada). |
| 9 | Offset del tail entre reinicios | **`seek` al final** entre reinicios. |
| 10 | Reset diario | Por cálculo de **próxima medianoche**. |
| 11 | Filtros para generalizar | **`F2B_IGNORE_JAILS` / `F2B_IGNORE_IPS`** opcionales. |
| 12 | Nombre del repo/paquete | **`fail2ban-telegram-notifier`** (el directorio local sigue siendo `f2b`). |
| 13 | Linter | **ESLint flat config + `typescript-eslint`**, sin Prettier, como script local (`pnpm lint`). |
| 14 | Re-registro en gateway | **Reintento periódico** del `register-handler` (el gateway no persiste handlers). |
| 15 | Arquitectura | **Hexagonal (puertos y adaptadores), obligatoria**: `domain/` puro sin I/O ni imports de `infrastructure/`; `application/` casos de uso (solo `domain`); `infrastructure/` adaptadores; `index.ts` composition root. Ficheros kebab-case, imports con extensión `.ts` explícita, identificadores en inglés, comentarios en español. |
| 16 | Logging | **Sin dependencias**: stdout/stderr (systemd/journal lo captura) y, si `LOG_FILE` está definido, append a ese fichero. Prohibido abrir rutas fijas de log. |

---

## 5. Estructura de ficheros propuesta (hexagonal)

Ficheros **kebab-case**, identificadores en **inglés**, imports con **extensión
explícita**. `domain/` sin I/O; `application/` casos de uso; `infrastructure/`
adaptadores; `index.ts` composition root.

```
f2b/
├── src/
│   ├── domain/
│   │   ├── entities/
│   │   │   ├── fail2ban-event.ts      # { jail, action: "ban"|"unban", ip }
│   │   │   ├── counter-state.ts       # { daily, permanent, total, last }
│   │   │   └── incoming-update.ts     # update normalizado (texto, callback, chat, thread)
│   │   ├── ports/
│   │   │   ├── notifier.ts            # NotifierPort: sendMessage, deleteMessage,
│   │   │   │                          #   answerCallback, editReplyMarkup
│   │   │   ├── update-source.ts       # UpdateSourcePort: start(handler)/stop()
│   │   │   ├── event-source.ts        # EventSourcePort: eventos fail2ban
│   │   │   └── counter-store.ts       # CounterStorePort: load/save
│   │   └── services/
│   │       ├── parse-fail2ban-line.ts # regex → Fail2banEvent | null (pura)
│   │       ├── shutdown-suppressor.ts # máquina de estados del flush_mode (pura)
│   │       ├── message-format.ts      # plantillas EXACTAS (es/en)
│   │       └── counter-rules.ts       # aplicar ban/unban/reset (pura)
│   ├── application/
│   │   ├── notify-fail2ban-events.ts  # consume EventSource → Notifier + CounterStore
│   │   ├── handle-command.ts          # /f2b, /chat_id, /help, callbacks
│   │   ├── show-counter.ts
│   │   ├── reset-counter.ts
│   │   └── daily-reset.ts
│   ├── infrastructure/
│   │   ├── config/env.ts              # loadConfig() + validación (por transporte)
│   │   ├── fail2ban/tail-log-source.ts# EventSourcePort: tail + rotación
│   │   ├── telegram/
│   │   │   ├── normalize-update.ts    # update crudo de Telegram → IncomingUpdate
│   │   │   ├── direct/
│   │   │   │   ├── direct-notifier.ts     # Bot API (sendMessage, deleteMessage...)
│   │   │   │   └── poller-update-source.ts# getUpdates long-polling
│   │   │   └── gateway/
│   │   │       ├── gateway-notifier.ts    # POST /api/send, /api/delete-message...
│   │   │       └── webhook-update-source.ts # servidor HTTP que recibe /tg-update + re-registro
│   │   ├── persistence/
│   │   │   ├── file-counter-store.ts
│   │   │   └── postgres-counter-store.ts
│   │   └── logging/logger.ts          # stdlib: stdout/stderr + append opcional a LOG_FILE
│   └── index.ts                       # composition root: elige adaptadores según TRANSPORT
├── tests/
│   ├── domain/  application/  infrastructure/  e2e/  test/helpers.ts
├── deploy/f2b.service.example
├── docs/PLAN.md
├── .env.example
├── README.md  README.es.md  LICENSE  .gitignore
├── package.json  tsconfig.json  vitest.config.ts  eslint.config.js
```

Flujo: `tail-log-source` emite `Fail2banEvent` → `notify-fail2ban-events` aplica
`shutdown-suppressor` + `counter-rules` + `message-format` → `NotifierPort`.
`update-source` (poller o webhook) emite `IncomingUpdate` → `handle-command`.
El composition root inyecta `direct` o `gateway` según `TRANSPORT`.

---

## 6. Contrato de configuración `.env.example` (dos transportes)

```dotenv
# ── Comunes ────────────────────────────────────────────────
TRANSPORT=direct                 # direct | gateway
TELEGRAM_CHAT_ID=                # obligatorio
TELEGRAM_TOPIC_ID=               # opcional (solo se aplica en direct)
TELEGRAM_PARSE_MODE=HTML
MESSAGE_LANG=es                  # es | en

# ── Transporte direct (Bot API) ────────────────────────────
TELEGRAM_BOT_TOKEN=              # obligatorio si TRANSPORT=direct
TELEGRAM_API_BASE_URL=https://api.telegram.org
TELEGRAM_POLL_TIMEOUT=30

# ── Transporte gateway (tg-gateway local) ──────────────────
TG_GATEWAY_URL=http://127.0.0.1:4000
WEBHOOK_HOST=127.0.0.1
WEBHOOK_PORT=14120
GATEWAY_REREGISTER_MS=60000      # 0 desactiva el re-registro periódico

# ── fail2ban ───────────────────────────────────────────────
FAIL2BAN_LOG_PATH=/var/log/fail2ban.log
F2B_PERMANENT_JAILS=recidive
F2B_IGNORE_JAILS=
F2B_IGNORE_IPS=
F2B_SUPPRESS_SHUTDOWN_FLUSH=true
F2B_POLL_INTERVAL_MS=1000

# ── Contador (backend) ─────────────────────────────────────
COUNTER_BACKEND=file             # file | postgres
COUNTER_FILE=./data/f2b-counter.json
DB_HOST=localhost
DB_PORT=5432
DB_NAME=f2b
DB_USER=f2b
DB_PASSWORD=

# ── Logging ────────────────────────────────────────────────
LOG_LEVEL=info
LOG_FILE=                        # vacío = solo stdout/journal
```

---

## 7. Plan de pruebas

**Unit de `domain` (puro, sin I/O):**
- `parse-fail2ban-line.test.ts`: líneas reales de `fail2ban.log` (`NOTICE [sshd] Ban
  1.2.3.4`, `Unban`, `Found`, `Restore Ban`), jail con espacios, prefijo `[pid]`,
  líneas sin `fail2ban.actions`, malformadas, IPv6 (documentar no-soporte).
- `shutdown-suppressor.test.ts`: secuencia shutdown → `Unban` suprimido; `Ban`
  reactiva; `Starting Fail2ban` reactiva; unbans previos al apagado no suprimidos.
- `message-format.test.ts`: cadenas **byte a byte** (ban normal, `recidive`, unban,
  rotación, /f2b, show_counter, reset, /chat_id), incluidos `tg-spoiler` y negritas.
- `counter-rules.test.ts`: ban → `daily+1`; `recidive` → `permanent+1`; unban → sin
  cambios; reset → `total += daily`, `daily=0`.

**Unit de `application`:** con dobles de `NotifierPort`, `CounterStorePort` y reloj
inyectado: `notify-fail2ban-events` (supresión + llamadas al store), `handle-command`
(callbacks y comandos registrados), `show-counter`, `reset-counter`, `daily-reset`
(no doble reset el mismo día).

**Integración de `infrastructure` (contra HTTP falso local, nunca Telegram real):**
- `gateway-notifier.test.ts`: servidor `node:http` local; comprueba ruta, body
  (`chat_id`, `text`, `parse_mode`, `reply_markup`), manejo de `{ok:false}` y 502.
- `webhook-update-source.test.ts`: POST de un `IncomingUpdate` al servidor y
  verificación de que invoca el handler y responde `200`.
- `direct-notifier.test.ts`: servidor falso en `TELEGRAM_API_BASE_URL`; verifica
  `/bot<token>/sendMessage`, respuestas `429`/`5xx`, `result` nulo y timeouts.
- `poller-update-source.test.ts`: `getUpdates` falso con offset, backoff ante error.
- `tail-log-source.test.ts`: ficheros temporales en `/tmp/opencode`; append, rotación
  por rename y truncado; eventos y avisos de rotación.
- `config/env.test.ts`: defaults por transporte y errores de validación.
- `e2e/`: prueba funcional de extremo a extremo en local: fichero de log temporal
  + tail real + notificador contra un servidor HTTP falso; demuestra que el
  mensaje sale por el adaptador (nunca contra Telegram real).

**Regla transversal:** `fetch`/HTTP siempre a un doble local; los tests nunca
deben golpear `api.telegram.org`. Excluir `src/index.ts` de cobertura (wiring).

---

## 8. Plan de publicación en GitHub (sin paquete npm)

- **Repo público, instalación desde fuente** (`git clone` + `pnpm install` + `pnpm build`
  + `node dist/index.js`). `package.json` con `"private": true`.
- **README bilingüe**: `README.md` (inglés) y `README.es.md` (español), con
  selector de idioma recíproco (patrón de mail-relay `README.md:16`), badges
  (License, Node, TypeScript) y **datos reales** (sin funcionalidades fantasma ni
  badges de aiogram obsoletos).
- **`LICENSE MIT`** (conservar; LICENSE ya existe en el origen).
- **`.env.example`** con los dos transportes (§6) y comentarios claros.
- **Unidad systemd de EJEMPLO genérica** `deploy/f2b.service.example`, con
  **placeholders** y sin datos privados:
  ```ini
  [Unit]
  Description=Fail2ban → Telegram notifier
  After=network-online.target
  Wants=network-online.target

  [Service]
  Type=simple
  User=YOUR_USER
  WorkingDirectory=/opt/fail2ban-telegram-notifier
  EnvironmentFile=/etc/fail2ban-telegram-notifier.env
  ExecStart=/usr/bin/node /opt/fail2ban-telegram-notifier/dist/index.js
  Restart=always
  RestartSec=5
  UMask=0077
  StandardOutput=journal
  StandardError=journal

  [Install]
  WantedBy=multi-user.target
  ```
  (Documentar que los secretos pueden venir de `EnvironmentFile` **o** del lanzador
  de secretos que use cada usuario; nunca versionar datos privados.)
- **`.gitignore`**: `.env`, `node_modules/`, `dist/`, `data/`, `*.log`, `coverage/`.
- Opcionales recomendados: `CONTRIBUTING.md`, `SECURITY.md`, plantillas de issue/PR.

---

## 9. Anexo — contrato REAL del tg-gateway (verificado en código)

Fuente: el repo local `tg-gateway`. API en
`http://127.0.0.1:4000`, **sin autenticación y solo loopback**
(`src/infrastructure/api-server.ts:241-252`).

| Endpoint | Método | Payload que envía el bot | Respuesta |
|---|---|---|---|
| `/api/register-handler` | POST | `{ command, webhook }` | `{ ok: true }` (api-server.ts:215-227) |
| `/api/send` | POST | `{ chat_id, text, parse_mode, reply_markup }` | `{ ok:true, result:{ chatId, messageId } }` o `502 {ok:false}` (api-server.ts:103-115, 56-67) |
| `/api/delete-message` | POST | `{ chat_id, message_id }` | `{ ok:true }` (api-server.ts:177-187) |
| `/api/answer-callback` | POST | `{ callback_query_id | callbackId | callback_id, text }` | `{ ok:true }` (api-server.ts:190-200) |
| `/api/edit-reply-markup` | POST | `{ chat_id, message_id, reply_markup }` | `{ ok:true }` (api-server.ts:163-174) |

**Inbound:** el gateway hace `POST` a tu webhook con el **update crudo de Telegram**
(`IncomingUpdate`; `src/domain/entities/message.ts:33-56`) y espera un `2xx`
(`src/infrastructure/forwarder.ts:50-56`). Enruta comandos por primer token
(`/f2b`) y callbacks por prefijo de `data` (`src/application/handle-update.ts:57-67,105-120`).

**Diferencias críticas frente a lo que asume el bot actual:**
1. `/api/send` **no acepta `message_thread_id`** (api-server.ts:105-110): el
   `TOPIC_ID` del bot (`gateway_client.py:24-25`) **se ignora**.
2. El gateway **no persiste handlers** (`handler-registry.ts`): tras reiniciar hay
   que re-registrar (decisión 15).
3. El gateway ya aplica rate-limit (1200 ms) y circuit breaker; en modo `direct`
   habrá que implementar rate-limit/reintentos en el propio bot.

---

## 10. Resumen de paridad (qué debe reproducir la v1 en TS)

- Notificar `Ban`, `Ban recidive` (permanente) y `Unban`, con los textos exactos de §1.5.
- Suprimir unbans de flush al apagar/reiniciar fail2ban (§1.4).
- Tail del log con detección de rotación (tamaño e inode) y avisos.
- Contador con la semántica de §1.6 y reset diario a medianoche + `not_touch`.
- Comandos `/f2b`, `/chat_id`, botones `show_counter`/`not_touch`, autoborrado a 6 s.
- Elegir transporte `direct`/`gateway` sin cambios de dominio.
- **Nuevo/mejora:** configuración 100 % externa, filtros opcionales, i18n,
  re-registro de handlers, y eliminar código muerto (`/start`, `/help` o registrarlos).
