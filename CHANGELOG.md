# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional `NOTIFY_MODE=batch`: accumulates bans/unbans and sends one single-line summary per aligned window (`BATCH_WINDOW_SEC`, must divide 86400), with `BATCH_SHOW_IPS`, `BATCH_MAX_EVENTS`, `NOTIFY_INSTANT_JAILS` and `NOTIFY_UNBANS` (`count`/`off`/`list`). Batch templates in `MessageTemplates` (es/en), counter updated once per successfully sent summary, failed sends retried next window with a capped in-memory buffer, shutdown flush on `SIGTERM`. Instant mode (default) unchanged.
- Batch midnight ordering: the daily reset waits for the pending batch summary (`flush()` as `beforeReset` hook) so bans from the last hour count before the counter resets; concurrent flushes serialize instead of overlapping.
- Truthful batch header: `📊 Last hour` / `📊 Última hora` when the summary covers exactly 60 minutes, otherwise a `📊 HH:MM–HH:MM` range over the period actually covered (late start, early flush, shutdown, or retry after a failed send no longer claim a full aligned window they did not cover). Hours with no events advance the covered period, so a quiet hour does not stretch the next range.

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

[Unreleased]: https://github.com/x0-jonatanfp/fail2ban-telegram-notifier/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/x0-jonatanfp/fail2ban-telegram-notifier/releases/tag/v1.0.0
