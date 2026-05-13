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
