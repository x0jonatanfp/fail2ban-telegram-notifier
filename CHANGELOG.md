# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## 1.2.0 (2026-11-14)

### Features

* **batch:** añade el modo batch con resumen periódico en una línea ([c6c91b2](https://github.com/x0jonatanfp/fail2ban-telegram-notifier/commit/c6c91b22883f5e395720ae69a4685b3408a2153e))
* **commands:** autoborra también la respuesta de /chat_id ([02da5ab](https://github.com/x0jonatanfp/fail2ban-telegram-notifier/commit/02da5ab31e4b37b60a55305cc1250b58b5277dcf))
* importa el notificador de fail2ban migrado a TypeScript ([e514899](https://github.com/x0jonatanfp/fail2ban-telegram-notifier/commit/e5148999ec47cd9526f49b135e5e8e97f16bd037))

### Bug Fixes

* **batch:** cabecera Última hora y rango siempre veraz ([44f6dde](https://github.com/x0jonatanfp/fail2ban-telegram-notifier/commit/44f6dde9b4609e2b25197fead4add5a938cf3cc1))
* **batch:** evita perder eventos y ordena el resumen con el reinicio diario ([c6e4081](https://github.com/x0jonatanfp/fail2ban-telegram-notifier/commit/c6e4081dd61b15bb100ab790f42b70df56a24199))
* **batch:** la cabecera es siempre Última hora, sin horas ([c68ef0b](https://github.com/x0jonatanfp/fail2ban-telegram-notifier/commit/c68ef0bedca076c0e6730472298b8f0e40a553c7))
* **batch:** la cabecera nunca muestra horas ([7aca3da](https://github.com/x0jonatanfp/fail2ban-telegram-notifier/commit/7aca3dae3859af496bc571f3d55c204e245f0f5b))
* **gateway:** no registra /start ni /help en el gateway ([00c5495](https://github.com/x0jonatanfp/fail2ban-telegram-notifier/commit/00c5495952c8370873c29d0cabe798eed3975baa))

## [1.0.0] - 2026-10-10

### Added

- First public release: a fail2ban → Telegram notifier with real-time log
  tailing (rotation detected by size **and** by inode).
- Ban, permanent-ban and unban alerts. Jails listed in `F2B_PERMANENT_JAILS`
  (default `recidive`) get a distinct message and feed the reoffender counter.
- Suppression of the fake `Unban` flood fail2ban emits on shutdown/restart
  (`F2B_SUPPRESS_SHUTDOWN_FLUSH`, on by default).
- Ban counter (daily / reoffenders / total / last action) with an automatic
  reset at local midnight and a manual reset button.
- Commands: `/f2b` (settings), `/chat_id` (find your ids), `/start`, `/help`.
- Two selectable transports via `TRANSPORT`:
  - `direct` — Telegram Bot API (`getUpdates` long-polling).
  - `gateway` — a local `tg-gateway` over loopback (registers commands, receives
    forwarded updates on a local HTTP server).
- Counter storage: JSON file by default (no database), optional PostgreSQL
  (`COUNTER_BACKEND=postgres`, requires the optional `pg` package).
- Message i18n: Spanish (default) and English (`MESSAGE_LANG`).
- Dependency-free structured logging to stdout/stderr (systemd/journald
  friendly), with an optional `LOG_FILE` append.
- Fail-fast environment validation with an aggregated, readable error list.
- Graceful shutdown on `SIGTERM`/`SIGINT`.
- Hexagonal architecture (`domain` / `application` / `infrastructure` + a
  composition root), with a test suite covering unit, adapter integration and an
  end-to-end path — never contacting Telegram.
- A generic systemd unit template (`deploy/f2b.service.example`).

[Unreleased]: https://github.com/x0jonatanfp/fail2ban-telegram-notifier/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/x0jonatanfp/fail2ban-telegram-notifier/releases/tag/v1.0.0
