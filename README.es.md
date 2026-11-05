<div align="center">

# fail2ban-telegram-notifier

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.18-blue)]()
[![TypeScript](https://img.shields.io/badge/built_with-TypeScript-3178C6)]()
[![Runtime dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen)]()

**Recibe los bloqueos y desbloqueos de fail2ban en Telegram, en tiempo real.**
**Cero dependencias en tiempo de ejecución. Dos transportes. Sobre Node.js a secas.**

</div>

---

<p align="center">🌐 <strong>También disponible en:</strong> <a href="README.md">Inglés</a></p>

---

## Funcionalidades

- **Seguimiento del log en tiempo real** — sigue `fail2ban.log` y sobrevive a la rotación (detectada por tamaño **y** por inodo).
- **Avisos de bloqueo, bloqueo permanente y desbloqueo** — las jails configuradas como *permanentes* (p. ej. `recidive`) reciben un mensaje distinto.
- **Sin desbloqueos falsos** — suprime la avalancha de líneas `Unban` que fail2ban emite al apagarse o reiniciarse.
- **Contador de bloqueos** — diarios, reincidentes y totales, con reinicio automático a medianoche local y botón de reinicio manual.
- **Comandos** — `/f2b` (configuración), `/chat_id` (averigua tus ids de chat/tema), `/start`, `/help`.
- **Dos transportes** — habla con Telegram directamente por la Bot API, o a través de un `tg-gateway` local.
- **Persistencia inmediata** — el contador vive en un fichero JSON por defecto (sin base de datos); PostgreSQL es opcional.
- **Mensajes bilingües** — español (por defecto) e inglés.
- **Pequeño y sin dependencias** — sin dependencias en ejecución; los logs van a stdout/stderr, que systemd/journald recoge.

---

## Requisitos

- **Node.js >= 22.18.0** para desarrollo (ejecuta el TypeScript directamente usando la transformación experimental de TypeScript integrada en Node). El artefacto compilado necesita **Node.js >= 22**.
- Un **token de bot** de Telegram (para el transporte `direct`) o un **`tg-gateway`** en marcha.
- **fail2ban** instalado y escribiendo en un fichero de log (por defecto `/var/log/fail2ban.log`).

---

## Inicio rápido

```bash
git clone https://github.com/x0-jonatanfp/fail2ban-telegram-notifier.git
cd fail2ban-telegram-notifier
pnpm install

cp .env.example .env
# edita .env: como mínimo TELEGRAM_CHAT_ID y TELEGRAM_BOT_TOKEN

pnpm build
node dist/index.js
```

Para desarrollo puedes ejecutar el TypeScript directamente (sin compilar), usando la transformación experimental de TypeScript integrada en Node:

```bash
pnpm dev       # node --watch (recarga al cambiar)
# o
pnpm start     # ejecuta el TypeScript una vez
```

Para producción, compila antes y ejecuta el bundle autocontenido: `pnpm build && node dist/index.js`.

### Averigua tu chat id

Pon cualquier cosa en `TELEGRAM_CHAT_ID`, arranca el bot y mándale `/chat_id`. Te responde con tu user id, el id del chat/grupo y (si aplica) el id del tema. Copia el chat id en `TELEGRAM_CHAT_ID` y reinicia.

---

## Configuración

Toda la configuración se hace por variables de entorno (ver [`.env.example`](.env.example)). El proceso carga un fichero `.env` si existe (con el cargador nativo de Node, sin `dotenv`) y, si no, lee el entorno real. La configuración se valida al arrancar: un valor inválido o ausente hace que el proceso **salga con una lista clara de errores** en lugar de arrancar a medias.

### Comunes

| Variable | Por defecto | Descripción |
|---|---|---|
| `TRANSPORT` | `direct` | `direct` (Bot API) o `gateway` (tg-gateway local). |
| `TELEGRAM_CHAT_ID` | — | **Obligatorio.** Chat/grupo donde se envían las notificaciones. |
| `TELEGRAM_TOPIC_ID` | — | Id del tema de foro. Solo se aplica en `direct` (ver limitaciones). |
| `TELEGRAM_PARSE_MODE` | `HTML` | Modo de parseo de los mensajes. |
| `MESSAGE_LANG` | `es` | Idioma de los mensajes: `es` o `en`. |

### Transporte `direct` (Bot API)

| Variable | Por defecto | Descripción |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | **Obligatorio con `TRANSPORT=direct`.** Token del bot (@BotFather). |
| `TELEGRAM_API_BASE_URL` | `https://api.telegram.org` | URL base de la Bot API (solo se cambia para self-hosting/tests). |
| `TELEGRAM_POLL_TIMEOUT` | `30` | Timeout del long-polling de `getUpdates`, en segundos. |

### Transporte `gateway` (tg-gateway local)

| Variable | Por defecto | Descripción |
|---|---|---|
| `TG_GATEWAY_URL` | `http://127.0.0.1:4000` | URL base del tg-gateway. |
| `WEBHOOK_HOST` | `127.0.0.1` | Interfaz donde este bot escucha los updates reenviados. |
| `WEBHOOK_PORT` | `14120` | Puerto donde este bot escucha los updates reenviados. |
| `GATEWAY_REREGISTER_MS` | `60000` | Cada cuánto re-registrar los comandos en el gateway (el gateway no persiste handlers). `0` lo desactiva. |

### fail2ban

| Variable | Por defecto | Descripción |
|---|---|---|
| `FAIL2BAN_LOG_PATH` | `/var/log/fail2ban.log` | Fichero de log a seguir. |
| `F2B_PERMANENT_JAILS` | `recidive` | Jails separadas por coma tratadas como *permanentes* (mensaje distinto + contador de reincidentes). |
| `F2B_IGNORE_JAILS` | *(vacío)* | Jails separadas por coma a ignorar por completo. |
| `F2B_IGNORE_IPS` | *(vacío)* | IPs separadas por coma a ignorar por completo. |
| `F2B_SUPPRESS_SHUTDOWN_FLUSH` | `true` | Suprime la avalancha de `Unban` falsos emitida al parar/reiniciar fail2ban. |
| `F2B_POLL_INTERVAL_MS` | `1000` | Intervalo de sondeo del log, en milisegundos. |

### Resúmenes por lote (opcional)

| Variable | Por defecto | Descripción |
|---|---|---|
| `NOTIFY_MODE` | `instant` | `instant` (un mensaje por evento) o `batch` (un resumen de una sola línea por ventana). Un valor inválido falla al arrancar. |
| `BATCH_WINDOW_SEC` | `3600` | Ventana del resumen, en segundos. Las ventanas se alinean al reloj local (con 3600 salen a las :00). Debe dividir a 86400. |
| `BATCH_SHOW_IPS` | `false` | `true` añade las IPs (en spoiler) agrupadas por jail. |
| `BATCH_MAX_EVENTS` | `0` | Si > 0, el resumen se envía antes de tiempo al alcanzar ese nº de eventos. `0` = sin tope. |
| `NOTIFY_INSTANT_JAILS` | *(vacío)* | Jails separadas por coma cuyos bans saltan el lote y se envían al instante. Esos eventos NO se recuentan en el resumen. Solo en modo batch. |
| `NOTIFY_UNBANS` | `count` | `count` (solo recuento), `off` (se omiten; si solo hubo unbans no se envía nada) o `list` (como `count` y, si `BATCH_SHOW_IPS=true`, añade también las IPs desbloqueadas). |

### Almacenamiento del contador

| Variable | Por defecto | Descripción |
|---|---|---|
| `COUNTER_BACKEND` | `file` | `file` (JSON, sin dependencias) o `postgres` (requiere el paquete opcional `pg`). |
| `COUNTER_FILE` | `./data/f2b-counter.json` | Ruta del fichero JSON con `COUNTER_BACKEND=file`. |
| `DB_HOST` | `localhost` | Host de PostgreSQL (solo para `postgres`). |
| `DB_PORT` | `5432` | Puerto de PostgreSQL. |
| `DB_NAME` | `f2b` | Nombre de la base de datos. |
| `DB_USER` | `f2b` | Usuario de la base de datos. |
| `DB_PASSWORD` | *(vacío)* | Contraseña de la base de datos. |

### Logging

| Variable | Por defecto | Descripción |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` o `error`. |
| `LOG_FILE` | *(vacío)* | Fichero opcional al que anexar los logs. Vacío = solo stdout/stderr (que systemd/journald recoge). |

---

## Transportes

### `direct` — Bot API de Telegram

El bot habla con Telegram directamente: `sendMessage`, `deleteMessage`, `answerCallbackQuery`, `editMessageReplyMarkup`, y lee los updates con long-polling de `getUpdates`. Soporta temas de foro vía `TELEGRAM_TOPIC_ID`.

### `gateway` — tg-gateway local

El bot habla con un `tg-gateway` local por loopback en lugar de con Telegram. Registra sus comandos en el gateway (`POST /api/register-handler`) y recibe los updates en un pequeño servidor HTTP local (`POST /tg-update`). Úsalo si ya tienes un gateway y quieres rate-limiting, circuit breaker y un único punto que guarda el token de Telegram.

> **Limitación conocida:** el `/api/send` del `tg-gateway` actual **no** acepta `message_thread_id`. En modo `gateway`, `TELEGRAM_TOPIC_ID` se ignora. En modo `direct` sí funciona.

### Ejemplo: `direct`

```dotenv
TRANSPORT=direct
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...       # tu token de bot, de @BotFather
TELEGRAM_CHAT_ID=-1001234567890            # usa /chat_id para descubrirlo
TELEGRAM_TOPIC_ID=42                       # opcional (tema de foro)
FAIL2BAN_LOG_PATH=/var/log/fail2ban.log
```

```bash
pnpm build && node dist/index.js
```

### Ejemplo: `gateway`

```dotenv
TRANSPORT=gateway
TG_GATEWAY_URL=http://127.0.0.1:4000
WEBHOOK_HOST=127.0.0.1
WEBHOOK_PORT=14120
TELEGRAM_CHAT_ID=-1001234567890            # usa /chat_id para descubrirlo
FAIL2BAN_LOG_PATH=/var/log/fail2ban.log
```

En este modo no hace falta token de bot: lo guarda el gateway. Asegúrate de que el gateway puede alcanzar `WEBHOOK_HOST:WEBHOOK_PORT` y de que este bot puede alcanzar `TG_GATEWAY_URL`.

---

## Semántica del contador

El contador tiene tres números más la hora de la última acción:

- **Diarios** (`📈`) — bloqueos de jails *no permanentes* desde el último reinicio.
- **Reincidentes** (`🚫`) — bloqueos de las jails listadas en `F2B_PERMANENT_JAILS` (p. ej. `recidive`). No se reinician solos.
- **Totales** (`🔒`) — acumulado de `diarios` a través de los reinicios.
- **Última acción** (`⏲️`) — hora local (`HH:MM:SS`) del último evento que tocó el contador.

Los reinicios ocurren automáticamente a medianoche local y de forma manual con el botón **"¡No tocar!"** de `/f2b`. Un reinicio mueve `diarios` a `totales`, deja `diarios` a `0` y no toca `reincidentes`.

- **Backend de fichero (por defecto):** un fichero JSON, escrito de forma atómica. No necesita base de datos.
- **Backend Postgres (opcional):** `COUNTER_BACKEND=postgres` reutiliza una tabla `f2b_stats` compatible con la heredada. Instala el driver opcional con `pnpm add pg`; el módulo se importa dinámicamente, así que la instalación por defecto nunca lo necesita.

### Modo batch (resumen periódico)

Con `NOTIFY_MODE=batch`, los bloqueos y desbloqueos se acumulan y se envía un resumen de una sola línea por ventana (bloques unidos con `·`). Las jails van ordenadas por recuento (de mayor a menor, empates por nombre); si hay más de 8 jails, el resto se pliega en `otras N` (N = suma de bloqueos plegados).

```
📊 Resumen 14:00–15:00 · 🔒 62 bloqueos (postfix 55, recidive 3, nginx-forbidden 4) · 🌐 58 desbloqueos
📊 Resumen 03:00–04:00 · 🔒 2 bloqueos (nginx-botsearch 2) · 🌐 1 desbloqueo
```

Con `BATCH_SHOW_IPS=true` cada jail añade sus IPs en spoiler en la misma línea; si el texto supera los 4096 caracteres de Telegram se trocea en varios mensajes de una sola línea. Una ventana sin eventos (visibles) no envía nada; con `NOTIFY_UNBANS=off` se omite el segmento `🌐 …`. Las jails de `NOTIFY_INSTANT_JAILS` saltan el lote y conservan el formato de siempre (sin recuento posterior). Los avisos de rotación de log siguen siendo instantáneos en ambos modos, y `F2B_IGNORE_JAILS` / `F2B_IGNORE_IPS` / `F2B_SUPPRESS_SHUTDOWN_FLUSH` se aplican antes de encolar, como antes.

El contador se actualiza UNA vez por resumen enviado con éxito, con todos sus bloqueos (misma regla que hoy: si el envío falla, no se actualiza). Si el envío falla, el lote se conserva para la siguiente ventana; el buffer en memoria tiene tope (descarta los eventos más antiguos) para no crecer sin límite ante un fallo sostenido.

> **Limitación:** el buffer vive en memoria. Un `SIGTERM` normal lo vacía al parar, pero un `kill -9` o un corte de energía pierde hasta una ventana de eventos.

---

## Despliegue (systemd)

1. Compila y copia el proyecto a `/opt/fail2ban-telegram-notifier`:

   ```bash
   pnpm install
   pnpm build
   sudo cp -r . /opt/fail2ban-telegram-notifier
   ```

   El `dist/index.js` compilado es un único bundle autocontenido: en ejecución **no** necesita `node_modules`.

2. Crea `/etc/fail2ban-telegram-notifier.env` a partir de `.env.example` y protégelo (contiene tu token):

   ```bash
   sudo install -m 600 /dev/null /etc/fail2ban-telegram-notifier.env
   sudo editor /etc/fail2ban-telegram-notifier.env
   ```

3. Instala la unidad de ejemplo (sustituye `YOUR_USER`) y actívala:

   ```bash
   sudo cp deploy/f2b.service.example /etc/systemd/system/fail2ban-telegram-notifier.service
   sudo editor /etc/systemd/system/fail2ban-telegram-notifier.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now fail2ban-telegram-notifier
   journalctl -u fail2ban-telegram-notifier -f
   ```

   Si inyectas los secretos con tu propia herramienta, sustituye `EnvironmentFile` por tu mecanismo — el proceso solo necesita las variables de entorno descritas arriba.

---

## Solución de problemas

- **Sale de inmediato con `Configuración inválida: ...`.** El mensaje lista cada variable ausente o inválida, una por línea. `TELEGRAM_CHAT_ID` es siempre obligatoria; `TELEGRAM_BOT_TOKEN` solo lo es con `TRANSPORT=direct`.
- **No llegan mensajes (`direct`).** Comprueba `TELEGRAM_CHAT_ID` (usa `/chat_id`), que el token sea válido y que el bot pueda publicar en ese chat (debe ser miembro; en grupos quizá haya que desactivar el modo privacidad o hacerlo admin). Los errores de Telegram (`429`, `4xx`, `5xx`) se registran.
- **No llegan mensajes (`gateway`).** El bot debe alcanzar `TG_GATEWAY_URL` (loopback) y el gateway debe alcanzar `WEBHOOK_HOST:WEBHOOK_PORT`. El gateway no persiste handlers, así que el bot se re-registra cada `GATEWAY_REREGISTER_MS`; si ves `Error registrando handler en el gateway.` repetido, el gateway está caído o la URL es incorrecta.
- **`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` al ejecutar el fuente.** Ejecutar `node src/index.ts` directamente necesita la bandera de transformación de Node; usa `pnpm dev` / `pnpm start` (que la incluyen), o ejecuta el bundle compilado (`pnpm build && node dist/index.js`).
- **`Fallo al arrancar: ... EADDRINUSE ...`.** El puerto del webhook (`WEBHOOK_PORT`, por defecto `14120`) ya está ocupado (solo modo `gateway`). Elige otro puerto o para lo que lo esté usando.
- **`Archivo ... no encontrado. Reintentando...` al arrancar.** El log aún no existe; el bot reintenta cada 10 s y lo coge solo cuando aparezca. Revisa `FAIL2BAN_LOG_PATH` y los permisos de lectura.
- **`Sin permiso para leer ...`.** El usuario del servicio no puede leer el log (`/var/log/fail2ban.log` suele ser solo de root). Añade el usuario al grupo `adm` o relaja los permisos; el bot reintenta cada 60 s.
- **Mensajes `Unban` obsoletos tras reiniciar fail2ban.** La avalancha falsa de apagado se suprime con `F2B_SUPPRESS_SHUTDOWN_FLUSH=true` (por defecto). Ponlo a `false` para verlo todo.
- **El contador muestra `-` en la última acción.** Todavía no se ha procesado ningún evento.
- **`COUNTER_BACKEND=postgres requiere el paquete opcional 'pg'.`** El backend Postgres necesita el driver opcional: ejecuta `pnpm add pg`, o usa `COUNTER_BACKEND=file`.
- **Una dirección IPv6 aparece truncada.** Limitación conocida (ver abajo).

---

## Desarrollo

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest run
pnpm test:coverage   # vitest + cobertura V8
pnpm build       # esbuild bundle → dist/index.js
```

### Arquitectura (hexagonal)

```
src/
├── domain/          # lógica pura + puertos (sin I/O, sin imports de infrastructure)
│   ├── entities/    #   Fail2banEvent, IncomingUpdate, CounterState, TelegramMessage
│   ├── ports/       #   Notifier, UpdateSource, EventSource, CounterStore, Logger
│   └── services/    #   parse-fail2ban-line, shutdown-suppressor, counter-rules, message-format, format-time
├── application/     # casos de uso (solo dependen de domain)
│   ├── notify-fail2ban-events.ts
│   ├── handle-command.ts
│   ├── show-counter.ts
│   ├── reset-counter.ts
│   └── daily-reset.ts
├── infrastructure/  # adaptadores (el único sitio con I/O)
│   ├── config/env.ts
│   ├── logging/logger.ts
│   ├── fail2ban/tail-log-source.ts
│   ├── telegram/{direct,gateway}/…
│   └── persistence/{file,postgres}-counter-store.ts
└── index.ts         # composition root: elige adaptadores según la config, monta y arranca
```

El flujo: `tail-log-source` emite eventos → `notify-fail2ban-events` aplica el supresor de apagado, las reglas del contador y las plantillas → un adaptador `Notifier` los envía. Los updates entrantes → `handle-command`. El composition root inyecta los adaptadores `direct` o `gateway` según `TRANSPORT`.

### Tests

`pnpm test` ejecuta tests unitarios de la lógica pura del dominio y tests de integración de cada adaptador contra **servidores HTTP falsos locales** — nunca contactan con Telegram. Un test de extremo a extremo escribe un log de fail2ban temporal, ejecuta el tail real y comprueba el payload HTTP exacto que sale por ambos adaptadores.

---

## Notas y limitaciones

- **No se parsean direcciones IPv6.** Igual que el bot original, el patrón de la línea solo captura `[0-9.]+`, así que un bloqueo IPv6 quedaría truncado (p. ej. `2001` de `2001:db8::1`).
- **`gateway` ignora `TELEGRAM_TOPIC_ID`** (ver arriba).
- **"Última acción" muestra `-`** cuando todavía no ha habido ningún evento.
- El contador **no** es un registro de seguridad; solo refleja lo que fail2ban reporta en su log.

---

## Licencia

MIT — ver [LICENSE](LICENSE).
