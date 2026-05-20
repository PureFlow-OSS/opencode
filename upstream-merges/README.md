# Upstream Merge Log

Track upstream comparison and phased merge work against `anomalyco/opencode`.

## Branch

- Working branch: `feat/merge-upstream`
- Base: local `dev`
- Upstream ref: `upstream/dev`

## Goal

Phase 1:
- merge only upstream changes that are compatible with our fork
- avoid regressions in session loading, startup, backend, and UI

Phase 2:
- compare overlapping hotspots manually
- keep our proven fixes as base layer
- adapt missing upstream behavior in small steps
- verify each hotspot with targeted checks

## Rules

- Do not remove our session/sync fixes wholesale.
- Prefer `ours as base, upstream in pieces`.
- Separate fork-only changes from generic fixes.
- Record every hotspot here so work can continue in a later session.

## Files

- `strategy.md`: merge method and guardrails
- `phase-2-hotspots.md`: hotspot-by-hotspot status
- `upstream-candidates.md`: our changes that may be worth upstream PRs
