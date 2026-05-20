# Strategy

## Current approach

Use our fork as active baseline. Do not revert broad local changes and re-merge upstream from scratch.

Reason:
- our fork already contains critical fixes for session loading and startup
- overlapping upstream commits hit same files, so bulk revert would be high-risk
- manual adaptation per hotspot is easier to validate than replaying both histories

## Merge buckets

### 1. Safe to cherry-pick

Use only for isolated upstream commits with no product-code conflicts.

Current safe pick:
- `44a35c589` `test(app): add session timeline smoke coverage (#26619)`

### 2. Already covered by our fork

If upstream fix touches same bug class and our current code already contains equivalent or stricter behavior, do not patch code again.

Record:
- upstream commit
- overlapping local commits
- reason coverage is sufficient

### 3. Needs adaptation

For overlapping hotspots:
- diff upstream commit against current branch
- identify exact missing behavior
- patch only missing behavior
- run targeted validation

### 4. Fork-only

Do not attempt to merge upstream/fork deltas in these areas unless needed for a specific feature:
- AI Factory
- RRZ branding
- updater server / rollout infra
- custom managed provider or managed MCP product flows

## Validation

Minimum per hotspot:
- package-local `bun typecheck`
- targeted tests when present
- note residual risk in `phase-2-hotspots.md`
