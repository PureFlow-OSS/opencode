# v1.14.36

## Added

- Added MCP URL validation so remote servers must use `http://` or `https://`.

## Improved

- MCP settings dialogs are now larger and better sized for editing more complex server setups.
- MCP updates now sync more consistently between Settings and the status popover, including faster local UI refreshes after changes.
- Desktop build packaging now includes the changelog file more reliably.

## Fixed

- Fixed MCP server deletion so removed entries stay deleted from global config files instead of reappearing from lower-priority config sources.
- Fixed stale MCP state races after config changes by waiting for instance invalidation before follow-up reloads.
- Fixed MCP status lists so failed or deleted entries do not linger in the status popover.

# v1.14.35

## Added

- Added a full access action to permission prompts.
- Added automatic compaction before switching to tighter-context models in both the app and TUI.

## Improved

- Permission prompts can now remember accepted commands, with clearer button labels in the session UI.
- Desktop update checks now route update-server requests through Electron when needed for managed environments.

## Fixed

- Fixed failures when switching a long conversation onto models with tighter context limits by compacting before the switch.
- Fixed desktop updater requests against HTTPS update servers that use private or self-signed certificates.

# v1.14.34

## Added

- Added a changelog view in Settings so release notes are easier to find in the app.
- Added beta rollout support to the updater.
- Added optional AI Factory host override support for managed provider setups.

## Improved

- AI Factory models are now prioritized more clearly in the provider experience.
- Model visibility handling was refined, including hiding embedding-only models where they should not be shown.
- Popular providers are now hidden when that section would otherwise be empty.
- Provider config handling now derives URLs more consistently from the update base URL and shares that config across managed updater paths.
- Updated the splash screen branding to the latest AI Factory logo.

## Fixed

- Hardened global sync against malformed project updates to reduce sync-related failures.
- Cleaned up updater config handling by omitting null fields where appropriate.
