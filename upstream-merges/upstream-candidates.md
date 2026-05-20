# Our Changes Worth Considering for Upstream

## Strong candidates

- `1120c10b1` `Fix session loading after restart`
- `102fa2283` `Load all sessions and messages again`
- `88dc5995c` `Guard stale sessions and projects during startup`
- `e524e2785` `Guard project lookups during layout boot`
- `0d6ff4252` `Fix boot flicker while loading projects`
- `ced906301` `Delay empty states until autoselect settles`
- `c397a03ee` `Harden global sync against malformed project updates`

## Medium candidates after cleanup

- `a12fd013f` `Add background bash process lifecycle support`
- `4f996783a` `feat: add corporate proxy support`
- webfetch series:
  - `84b1a5ccd`
  - `ae8a7d64d`
  - `f4676c772`
  - `a31da52f6`
  - `6f57f37da`
- `b8559ffa6` `Fix bash tests for older PowerShell`

## Not upstream candidates

- AI Factory / RRZ / branding
- custom updater server and rollout infra
- product-specific managed provider or managed MCP flows
