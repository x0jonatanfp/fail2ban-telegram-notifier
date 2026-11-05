<div align="center">

# fail2ban-telegram-notifier

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.18-blue)]()
[![TypeScript](https://img.shields.io/badge/built_with-TypeScript-3178C6)]()
[![Runtime dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen)]()

**Get fail2ban bans and unbans in Telegram, in real time.**
**Zero runtime dependencies. Two transports. Runs on plain Node.js.**

</div>

---

<p align="center">🌐 <strong>Also available in:</strong> <a href="README.es.md">Spanish</a></p>

---

## Features

- **Real-time log tailing** — follows `fail2ban.log` and survives log rotation (detected by size **and** by inode).
- **Ban, permanent-ban and unban alerts** — jails configured as *permanent* (e.g. `recidive`) get a distinct message.
- **No false unbans** — suppresses the mass of `Unban` lines fail2ban emits when it shuts down or restarts.
- **Ban counter** — per-day, reoffenders and total, with an automatic reset at local midnight and a manual reset button.
- **Slash commands** — `/f2b` (settings), `/chat_id` (find your chat/topic ids), `/start`, `/help`.
- **Two transports** — talk to Telegram directly through the Bot API, or through a local `tg-gateway`.
- **Plug-and-play storage** — the counter lives in a JSON file by default (no database); PostgreSQL is optional.
- **Bilingual messages** — Spanish (default) and English.
- **Tiny and dependency-free** — no runtime dependencies; logs to stdout/stderr so systemd/journald captures them.

---

## Requirements

- **Node.js >= 22.18.0** for development (it runs the TypeScript source directly using Node's built-in experimental TypeScript transform). The compiled artifact needs **Node.js >= 22**.
- A Telegram **bot token** (for the `direct` transport) or a running **`tg-gateway`**.
- **fail2ban** installed and writing to a log file (default `/var/log/fail2ban.log`).

---

## Quick start

```bash
git clone https://github.com/x0-jonatanfp/fail2ban-telegram-notifier.git
cd fail2ban-telegram-notifier
pnpm install

cp .env.example .env
# edit .env: at least TELEGRAM_CHAT_ID and TELEGRAM_BOT_TOKEN

pnpm build
node dist/index.js
```

For development you can run the TypeScript source directly (no build step), using Node's built-in experimental TypeScript transform:

```bash
pnpm dev       # node --watch (reloads on change)
# or
pnpm start     # run the TypeScript source once
```

For production, build first and run the self-contained bundle: `pnpm build && node dist/index.js`.

### Find your chat id

Put anything as `TELEGRAM_CHAT_ID`, start the bot, and send it `/chat_id`. It replies with your user id, the chat/group id and (if any) the topic id. Copy the chat id into `TELEGRAM_CHAT_ID` and restart.

---

## Configuration

All configuration is done through environment variables (see [`.env.example`](.env.example)). The process loads a `.env` file if present (using Node's built-in loader, no `dotenv`) and otherwise reads the real environment. Configuration is validated at startup: an invalid or missing value makes the process **exit with a clear list of errors** instead of starting half-configured.

### Common

| Variable | Default | Description |
|---|---|---|
| `TRANSPORT` | `direct` | `direct` (Bot API) or `gateway` (local tg-gateway). |
| `TELEGRAM_CHAT_ID` | — | **Required.** Chat/group where notifications are sent. |
| `TELEGRAM_TOPIC_ID` | — | Forum topic id. Only applied in `direct` (see limitations). |
| `TELEGRAM_PARSE_MODE` | `HTML` | Message parse mode. |
| `MESSAGE_LANG` | `es` | Message language: `es` or `en`. |

### Transport: `direct` (Bot API)

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | **Required when `TRANSPORT=direct`.** Bot token from @BotFather. |
| `TELEGRAM_API_BASE_URL` | `https://api.telegram.org` | Bot API base URL (change only for self-hosting/tests). |
| `TELEGRAM_POLL_TIMEOUT` | `30` | `getUpdates` long-polling timeout, in seconds. |

### Transport: `gateway` (local tg-gateway)

| Variable | Default | Description |
|---|---|---|
| `TG_GATEWAY_URL` | `http://127.0.0.1:4000` | Base URL of the tg-gateway. |
| `WEBHOOK_HOST` | `127.0.0.1` | Interface where this bot listens for forwarded updates. |
| `WEBHOOK_PORT` | `14120` | Port where this bot listens for forwarded updates. |
| `GATEWAY_REREGISTER_MS` | `60000` | How often to re-register commands in the gateway (the gateway does not persist handlers). `0` disables it. |

### fail2ban

| Variable | Default | Description |
|---|---|---|
| `FAIL2BAN_LOG_PATH` | `/var/log/fail2ban.log` | Log file to follow. |
| `F2B_PERMANENT_JAILS` | `recidive` | Comma-separated jails treated as *permanent* (distinct message + reoffender counter). |
| `F2B_IGNORE_JAILS` | *(empty)* | Comma-separated jails to ignore completely. |
| `F2B_IGNORE_IPS` | *(empty)* | Comma-separated IPs to ignore completely. |
| `F2B_SUPPRESS_SHUTDOWN_FLUSH` | `true` | Suppress the fake `Unban` flood emitted when fail2ban stops/restarts. |
| `F2B_POLL_INTERVAL_MS` | `1000` | Log polling interval, in milliseconds. |

### Batch summaries (optional)

| Variable | Default | Description |
|---|---|---|
| `NOTIFY_MODE` | `instant` | `instant` (one message per event) or `batch` (one single-line summary per window). Invalid values fail fast. |
| `BATCH_WINDOW_SEC` | `3600` | Summary window, in seconds. Windows align to the local clock (with 3600 on the hour). Must divide 86400. |
| `BATCH_SHOW_IPS` | `false` | `true` adds the IPs (as spoilers) grouped by jail. |
| `BATCH_MAX_EVENTS` | `0` | If > 0, the summary is sent early when the buffer reaches that many events. `0` = no cap. |
| `NOTIFY_INSTANT_JAILS` | *(empty)* | Comma-separated jails whose bans skip the batch and are sent instantly. Those events are not counted in the summary. Batch mode only. |
| `NOTIFY_UNBANS` | `count` | `count` (unbans counted), `off` (unbans omitted; a window with only unbans sends nothing) or `list` (like `count` plus, with `BATCH_SHOW_IPS=true`, the unbanned IPs). |

### Counter storage

| Variable | Default | Description |
|---|---|---|
| `COUNTER_BACKEND` | `file` | `file` (JSON, no dependencies) or `postgres` (requires the optional `pg` package). |
| `COUNTER_FILE` | `./data/f2b-counter.json` | JSON file path when `COUNTER_BACKEND=file`. |
| `DB_HOST` | `localhost` | PostgreSQL host (only for `postgres`). |
| `DB_PORT` | `5432` | PostgreSQL port. |
| `DB_NAME` | `f2b` | Database name. |
| `DB_USER` | `f2b` | Database user. |
| `DB_PASSWORD` | *(empty)* | Database password. |

### Logging

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `LOG_FILE` | *(empty)* | Optional file to append logs to. Empty = stdout/stderr only (captured by systemd/journald). |

---

## Transports

### `direct` — Telegram Bot API

The bot talks to Telegram itself: `sendMessage`, `deleteMessage`, `answerCallbackQuery`, `editMessageReplyMarkup`, and it reads updates with `getUpdates` long-polling. Supports forum topics via `TELEGRAM_TOPIC_ID`.

### `gateway` — local tg-gateway

The bot talks to a local `tg-gateway` over loopback instead of Telegram. It registers its commands with the gateway (`POST /api/register-handler`) and receives updates on a small local HTTP server (`POST /tg-update`). Use this if you already run a gateway and want rate-limiting, a circuit breaker and a single point that holds the Telegram token.

> **Known limitation:** the current `tg-gateway` `/api/send` does **not** accept `message_thread_id`. In `gateway` mode `TELEGRAM_TOPIC_ID` is therefore ignored. In `direct` mode it works.

### Example: `direct`

```dotenv
TRANSPORT=direct
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...       # your bot token from @BotFather
TELEGRAM_CHAT_ID=-1001234567890            # use /chat_id to find it
TELEGRAM_TOPIC_ID=42                       # optional (forum topic)
FAIL2BAN_LOG_PATH=/var/log/fail2ban.log
```

```bash
pnpm build && node dist/index.js
```

### Example: `gateway`

```dotenv
TRANSPORT=gateway
TG_GATEWAY_URL=http://127.0.0.1:4000
WEBHOOK_HOST=127.0.0.1
WEBHOOK_PORT=14120
TELEGRAM_CHAT_ID=-1001234567890            # use /chat_id to find it
FAIL2BAN_LOG_PATH=/var/log/fail2ban.log
```

No bot token is needed in this mode: the gateway holds it. Make sure the gateway can reach `WEBHOOK_HOST:WEBHOOK_PORT` and that this bot can reach `TG_GATEWAY_URL`.

---

## Counter semantics

The counter has three numbers plus the last action time:

- **Daily** (`📈`) — bans of *non-permanent* jails since the last reset.
- **Reoffenders** (`🚫`) — bans of jails listed in `F2B_PERMANENT_JAILS` (e.g. `recidive`). These never reset automatically.
- **Total** (`🔒`) — accumulated `daily` across resets.
- **Last action** (`⏲️`) — local time (`HH:MM:SS`) of the last event that touched the counter.

Resets happen automatically at local midnight and manually via the `/f2b` → **"Do not touch!"** button. A reset moves `daily` into `total`, sets `daily` to `0`, and leaves `reoffenders` untouched.

- **File backend (default):** a JSON file, written atomically. No database needed.
- **Postgres backend (optional):** `COUNTER_BACKEND=postgres` reuses a legacy-compatible `f2b_stats` table. Install the optional driver with `pnpm add pg`; the module is imported dynamically so the default install never needs it.

### Batch mode (periodic summary)

With `NOTIFY_MODE=batch`, bans and unbans accumulate and one single-line summary per window is sent (blocks joined with `·`). Jails are ordered by count (descending, name on ties); beyond 8 jails the rest folds into `other N` (N = folded bans).

```
📊 Last hour · 🔒 62 bans (postfix 55, recidive 3, nginx-forbidden 4) · 🌐 58 unbans
📊 Last hour · 🔒 2 bans (nginx-botsearch 2) · 🌐 1 unban
```

The header is always `📊 Last hour` (never clock times), and it is a single fixed text: after a restart, an early flush (`BATCH_MAX_EVENTS`) or a retry it refers to the period since the previous summary.

With `BATCH_SHOW_IPS=true` each jail gets its IPs as spoilers on the same line; over-long summaries split into several ≤ 4096-character single-line messages. A window with no (visible) events sends nothing; with `NOTIFY_UNBANS=off` the `🌐 …` segment is omitted. Jails in `NOTIFY_INSTANT_JAILS` skip the batch and keep the instant format (and are not counted in the summary). Log-rotation notices stay instant in both modes, and `F2B_IGNORE_JAILS` / `F2B_IGNORE_IPS` / `F2B_SUPPRESS_SHUTDOWN_FLUSH` apply before batching, as before.

The counter is updated once per successfully sent summary with all its bans (same rule as instant: a failed send does not touch the counter). On send failure the batch is kept for the next window; the in-memory buffer is capped (oldest events dropped) so a sustained outage cannot grow without bound.

> **Limitation:** the buffer lives in memory. A normal `SIGTERM` flushes it on shutdown, but a `kill -9` or power loss loses up to one window of events.

---

## Deployment (systemd)

1. Build and copy the project to `/opt/fail2ban-telegram-notifier`:

   ```bash
   pnpm install
   pnpm build
   sudo cp -r . /opt/fail2ban-telegram-notifier
   ```

   The compiled `dist/index.js` is a single self-contained bundle: the runtime does **not** need `node_modules`.

2. Create `/etc/fail2ban-telegram-notifier.env` from `.env.example` and protect it (it holds your token):

   ```bash
   sudo install -m 600 /dev/null /etc/fail2ban-telegram-notifier.env
   sudo editor /etc/fail2ban-telegram-notifier.env
   ```

3. Install the example unit (replace `YOUR_USER`) and enable it:

   ```bash
   sudo cp deploy/f2b.service.example /etc/systemd/system/fail2ban-telegram-notifier.service
   sudo editor /etc/systemd/system/fail2ban-telegram-notifier.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now fail2ban-telegram-notifier
   journalctl -u fail2ban-telegram-notifier -f
   ```

   If you inject secrets with your own tool, replace `EnvironmentFile` with your mechanism — the process only needs the environment variables described above.

---

## Troubleshooting

- **It exits immediately with `Configuración inválida: ...`.** The message lists every missing or invalid variable, one per line. `TELEGRAM_CHAT_ID` is always required; `TELEGRAM_BOT_TOKEN` is required only for `TRANSPORT=direct`.
- **No messages arrive (`direct`).** Check `TELEGRAM_CHAT_ID` (use `/chat_id`), that the token is valid, and that the bot can post in that chat (it must be a member; for groups you may need to disable privacy mode or make it admin). Telegram errors (`429`, `4xx`, `5xx`) are logged.
- **No messages arrive (`gateway`).** The bot must reach `TG_GATEWAY_URL` (loopback) and the gateway must reach `WEBHOOK_HOST:WEBHOOK_PORT`. The gateway does not persist handlers, so the bot re-registers every `GATEWAY_REREGISTER_MS`; repeated `Error registrando handler en el gateway.` means the gateway is down or the URL is wrong.
- **`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` when running the source.** Running `node src/index.ts` directly needs Node's transform flag; use `pnpm dev` / `pnpm start` (which set it) instead, or run the compiled bundle (`pnpm build && node dist/index.js`).
- **`Fallo al arrancar: ... EADDRINUSE ...`.** The webhook port (`WEBHOOK_PORT`, default `14120`) is already in use (`gateway` mode only). Pick another port or stop whatever holds it.
- **`Archivo ... no encontrado. Reintentando...` on start.** The log does not exist yet; the bot retries every 10 s and picks it up automatically once it appears. Verify `FAIL2BAN_LOG_PATH` and read permissions.
- **`Sin permiso para leer ...`.** The service user cannot read the log (`/var/log/fail2ban.log` is often root-only). Add the user to the `adm` group or relax permissions; the bot retries every 60 s.
- **Stale `Unban` messages after restarting fail2ban.** The fake shutdown flood is suppressed with `F2B_SUPPRESS_SHUTDOWN_FLUSH=true` (default). Set it to `false` to see everything.
- **The counter shows `-` for the last action.** No event has been processed yet.
- **`COUNTER_BACKEND=postgres requiere el paquete opcional 'pg'.`.** The Postgres backend needs the optional driver: run `pnpm add pg`, or switch to `COUNTER_BACKEND=file`.
- **An IPv6 address looks truncated.** Known limitation (see below).

---

## Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest run
pnpm test:coverage   # vitest + cobertura V8
pnpm build       # esbuild bundle → dist/index.js
```

### Architecture (hexagonal)

```
src/
├── domain/          # pure logic + ports (no I/O, no infrastructure imports)
│   ├── entities/    #   Fail2banEvent, IncomingUpdate, CounterState, TelegramMessage
│   ├── ports/       #   Notifier, UpdateSource, EventSource, CounterStore, Logger
│   └── services/    #   parse-fail2ban-line, shutdown-suppressor, counter-rules, message-format, format-time
├── application/     # use cases (depend only on domain)
│   ├── notify-fail2ban-events.ts
│   ├── handle-command.ts
│   ├── show-counter.ts
│   ├── reset-counter.ts
│   └── daily-reset.ts
├── infrastructure/  # adapters (the only place with I/O)
│   ├── config/env.ts
│   ├── logging/logger.ts
│   ├── fail2ban/tail-log-source.ts
│   ├── telegram/{direct,gateway}/…
│   └── persistence/{file,postgres}-counter-store.ts
└── index.ts         # composition root: picks adapters from config, wires and starts
```

The flow: `tail-log-source` emits events → `notify-fail2ban-events` applies the shutdown suppressor, the counter rules and the message templates → a `Notifier` adapter sends them. Incoming updates → `handle-command`. The composition root injects the `direct` or `gateway` adapters based on `TRANSPORT`.

### Tests

`pnpm test` runs unit tests for the pure domain logic and integration tests for every adapter against **local fake HTTP servers** — they never contact Telegram. An end-to-end test writes a temporary fail2ban log, runs the real tail, and asserts the exact HTTP payload that leaves through both adapters.

---

## Notes and limitations

- **IPv6 addresses are not parsed.** Like the original bot, the log line pattern only captures `[0-9.]+`, so an IPv6 ban would be truncated (e.g. `2001` from `2001:db8::1`).
- **`gateway` ignores `TELEGRAM_TOPIC_ID`** (see above).
- **"Last action" shows `-`** when there has been no event yet.
- The counter is **not** a security log; it only mirrors what fail2ban reports on its log.

---

## License

MIT — see [LICENSE](LICENSE).
