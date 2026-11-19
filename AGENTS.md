# AGENTS.md · f2b

Guía para agentes de código que trabajan en este repositorio. Qué es, cómo se instala y cómo se usa está en el `README.md`.

## Qué es

**Recibe los bloqueos y desbloqueos de fail2ban en Telegram, en tiempo real.** **Cero dependencias en tiempo de ejecución. Dos transportes. Sobre Node.js a secas.**

## Estructura

- `.github/`
- `deploy/`
- `src/`
- `tests/`
- `.env.example`
- `.gitignore`
- `.versionrc.json`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `README.es.md`
- `README.md`
- `eslint.config.js`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.json`
- `vitest.config.ts`

## Comandos

Scripts de `package.json` (raíz):

| Comando | Ejecuta |
| --- | --- |
| `pnpm dev` | `node --watch --experimental-transform-types --disable-warning=ExperimentalWarning src/index.ts` |
| `pnpm start` | `node --experimental-transform-types --disable-warning=ExperimentalWarning src/index.ts` |
| `pnpm build` | `esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/index.js` |
| `pnpm serve` | `node dist/index.js` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `eslint .` |
| `pnpm test` | `vitest run` |
| `pnpm test:watch` | `vitest` |
| `pnpm test:coverage` | `vitest run --coverage` |
| `pnpm release` | `npx -y commit-and-tag-version@13.3.0` |

## Convenciones

- Gestor de paquetes: **pnpm** (según el lockfile).
- Lint/formato: `eslint.config.js`.
- Tests en `tests/`.
- El despliegue versionado (unidad systemd y similares) vive en `deploy/`. Los datos de esta máquina (rutas, puertos, perfiles de secretos) no van aquí: están fuera del repo.
- Configuración por entorno: copia `.env.example` a `.env` (ignorado por git). Nunca se versionan valores reales.
- Versión y `CHANGELOG.md` los genera la release (skill `my-commits`); no se editan a mano.

## Mantenimiento

- Este fichero y el `README.md` se actualizan en el mismo cambio que los deja obsoletos.
- Aquí solo va lo que puede ser público: nada de rutas locales, puertos de la máquina, IPs, perfiles de secretos ni datos personales.
