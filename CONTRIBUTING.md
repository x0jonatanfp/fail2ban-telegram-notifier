# Contributing

Thanks for your interest! This is a small, focused project. Keep changes tight
and consistent with what is already there.

## Requirements

- Node.js >= 22.18.0
- pnpm

## Getting started

```bash
pnpm install
pnpm test          # unit + integration + e2e
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint
pnpm build         # esbuild bundle -> dist/index.js
```

## Ground rules

- **Hexagonal architecture is mandatory.** Logic lives in `src/domain` (pure, no
  I/O) and `src/application` (use cases that depend only on `domain`). All I/O
  lives in `src/infrastructure`. `src/index.ts` is the composition root and is
  the only place that wires concrete adapters.
- **Keep the runtime dependency count at zero.** New runtime dependencies need a
  strong justification. Prefer the Node.js standard library.
- **Files are kebab-case** and imports use explicit `.ts` extensions.
- **Identifiers in English; comments in Spanish** (project convention).
- **Tests are mandatory for behavior changes.** Never hit the real Telegram API:
  point `fetch`/HTTP at a local fake server (see `tests/test/helpers.ts`).
- **No automated pipeline.** This project is run and deployed by hand. Do not add
  build/release automation or container definitions; keep the toolchain minimal.

## Pull requests

1. Create a branch, make focused commits.
2. Make sure `pnpm typecheck && pnpm lint && pnpm test` are green.
3. Describe **what** changed and **why**.
4. Update `CHANGELOG.md` under `## [Unreleased]` when relevant.

## Reporting bugs

Open an issue using the provided template. Include your OS, Node version, the
transport (`direct`/`gateway`), and the relevant log lines (redact your token and
chat id!).
