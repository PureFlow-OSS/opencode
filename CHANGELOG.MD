# PureFlow OpenCode Fork Changelog

This file documents the PureFlow/RRZ changes carried by this fork relative to the upstream
`anomalyco/opencode` codebase. It is not a full upstream release changelog.

## 2026-05-02 - Upstream `dev` Merge

Merged upstream `anomalyco/opencode` `dev` through commit `becf57ee6` and preserved the fork customizations below.

### RRZ AI Factory Provider

- Added `aifactory` as a first-class provider backed by the RRZ AI Factory OpenAI-compatible API.
- Added RRZ AI Factory token handling in CLI, TUI, and app provider connection flows.
- Added dynamic model discovery from RRZ AI Factory `/models`.
- Added model limit and capability overrides from updater-served provider config.
- Added migration from legacy inline `provider.aifactory.options.apiKey` config into the auth store.
- Kept `github-copilot` and `aifactory` as required providers when provider allowlists are configured.
- Preserved upstream `models.dev` loading while layering fork-only providers on top.

### Managed Configuration

- Added support for updater-served provider configuration payloads.
- Added support for managed config files and macOS managed preferences.
- Added `http_proxy` and `use_http_proxy` config fields.
- Applied configured HTTP proxy settings to provider calls, web fetch, web search, and Exa MCP usage.
- Kept RRZ AI Factory traffic out of proxy routing via `NO_PROXY`.

### Managed MCP

- Added server-discovered managed MCP configuration.
- Added `/mcp/managed` on both legacy and experimental HTTP APIs.
- Added app UI to show managed MCP servers alongside local MCP entries.
- Added PAT metadata support for managed remote MCP servers, including prompting and saving headers.
- Preserved local user MCP overrides over managed MCP entries.

### Agent Tools

- Extended `bash` with `run_in_background`.
- Added `bash_read` and `bash_stop` tools for inspecting and stopping background commands.
- Added a built-in `playwright` tool using local browser automation.
- Kept Windows and PowerShell path permission handling for bash commands.

### Desktop Updates

- Added Electron update support using `electron-updater`.
- Added Windows updater helper project and packaging hooks.
- Added Tauri desktop updater wiring and localized updater messages.
- Added updater enablement through desktop runtime config.
- Added updater server infrastructure under `infra/opencode-updater`.

### Branding and App Defaults

- Changed desktop app name strings to `RRZ OpenCode Desktop`.
- Added default MOTD text of `RRZ AI Factory`.
- Prioritized GitHub Copilot and RRZ AI Factory in provider lists.
- Added RRZ AI Factory-specific provider copy and selection behavior.

### Merge Fixes

- Restored upstream dynamic `models.dev` database loading after a merge conflict had reduced it to fork-only providers.
- Re-applied fork-only provider entries on top of upstream model loading.
- Updated MCP experimental HTTP API routes for upstream instance/workspace routing middleware changes.
- Preserved legacy-shaped unsupported OAuth error responses for MCP routes.
- Regenerated JavaScript SDK/OpenAPI artifacts after merging upstream API changes.

### Verification

- `bun typecheck` passed in `packages/opencode`.
- `bun typecheck` passed in `packages/app`.
- `bun typecheck` passed in `packages/desktop`.
- `bun typecheck` passed in `packages/desktop-electron`.
- `bun typecheck` passed in `packages/sdk/js`.
- Targeted fork tests passed in `packages/opencode`: provider, managed provider config, MCP HTTP API, MCP OAuth, bash/background tools, registry/playwright.
