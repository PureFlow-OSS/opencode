# OpenCode — Project Guide

## What is this?

OpenCode is an **open-source AI coding agent** — a provider-agnostic alternative to Claude Code. It uses a client/server architecture so a single server instance can power multiple frontends (TUI, web, desktop app, mobile).

Repository: https://github.com/anomalyco/opencode  
Default branch: **`dev`** (not `main`; local `main` may not exist — use `dev` or `origin/dev` for diffs)

---

## Monorepo Layout

| Package | Description |
|---|---|
| `packages/opencode` | Core business logic + HTTP server (Bun runtime) |
| `packages/opencode/src/cli` | CLI entrypoint; TUI lives in `cli/cmd/tui/` (SolidJS + opentui) |
| `packages/opencode/src/server` | Hono-based HTTP API server (default port 4096) |
| `packages/app` | Shared web UI (SolidJS) |
| `packages/desktop` | Native desktop app (Tauri wrapping `packages/app`) |
| `packages/desktop-electron` | Electron-based desktop variant |
| `packages/sdk/js` | Auto-generated JavaScript SDK |
| `packages/plugin` | `@opencode-ai/plugin` source |
| `packages/core` | Shared core utilities (Effect, filesystem, installation) |

Build tool: **Turborepo** (`turbo.json`). Package manager: **Bun 1.3+**.

---

## Development Commands

```bash
# From repo root
bun install          # install all deps
bun dev              # start TUI (in packages/opencode dir)
bun dev <dir>        # start TUI targeting a specific directory
bun dev serve        # start headless HTTP server on port 4096
bun dev web          # start server + open web interface
bun dev .            # run against the opencode repo itself

# Web UI (needs server running separately)
bun run --cwd packages/app dev     # dev server at http://localhost:5173

# Desktop
bun run --cwd packages/desktop tauri dev   # native Tauri app
bun run --cwd packages/desktop dev         # web-only (no native shell)

# Build standalone binary
./packages/opencode/script/build.ts --single
# Output: ./packages/opencode/dist/opencode-<platform>/bin/opencode

# SDK regeneration (after changing server.ts or routes)
./script/generate.ts
# Also: ./packages/sdk/js/script/build.ts

# Type checking — ALWAYS from package dir, never tsc directly
cd packages/opencode && bun typecheck

# Tests — ALWAYS from package dir, never from repo root
cd packages/opencode && bun test --timeout 30000
```

---

## Architecture

- **Server**: Hono HTTP API on port 4096; routes under `packages/opencode/src/server/routes/`
- **API spec**: See `specs/project.md` for the REST API shape (`/project`, `/project/:id/session`, etc.)
- **Storage**: Drizzle ORM + SQLite (bun-sqlite in Bun, node adapter otherwise)
- **Functional style**: Uses the [Effect](https://effect.website/) library throughout (`packages/core/src/effect/`)
- **Provider-agnostic**: Works with Claude, OpenAI, Google, local models, and OpenCode Zen
- **LSP**: Built-in Language Server Protocol support
- **MCP**: Model Context Protocol support

---

## Style Guide (from AGENTS.md)

- **Bun APIs**: Prefer `Bun.file()`, etc. over Node equivalents
- **No try/catch**: Use `.catch()` instead
- **No `any`**: Use precise types; rely on type inference — avoid explicit annotations unless exporting
- **No `else`**: Prefer early returns
- **`const` over `let`**: Use ternaries or early returns instead of reassignment
- **No unnecessary destructuring**: Use dot notation (`obj.a`) to preserve context
- **Inline single-use variables**: Don't create a variable just to use it once
- **Functional array methods**: `flatMap`, `filter`, `map` over `for` loops; use type guards on `filter`
- **Drizzle schemas**: snake_case field names so column names don't need string overrides
- **Keep logic in one function**: Unless it's genuinely composable/reusable
- **Config modules**: Follow the self-export pattern at the top of `src/config` files

---

## Testing Rules

- Tests **cannot run from the repo root** (guarded by `do-not-run-tests-from-root`)
- Run from the package directory: `cd packages/opencode && bun test`
- Avoid mocks — test real implementations, don't duplicate logic in tests

---

## PR & Commit Conventions

Titles follow conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`  
Optional scope: `feat(app):`, `fix(desktop):`, `chore(opencode):`

**Issue-first policy**: All PRs must reference an existing issue (`Fixes #123`).  
UI/core feature PRs require design review with the core team before implementation.

---

## Key Notes

- Run `./script/generate.ts` whenever `packages/opencode/src/server/server.ts` or routes change
- `bun dev` = local equivalent of the built `opencode` command
- Server mode is opt-in; set `OPENCODE_SERVER_PASSWORD` for HTTP Basic Auth
- No AI-generated PR descriptions or issue text — maintainers will close them
