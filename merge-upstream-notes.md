# Merge Upstream Notes

Date: 2026-06-25

## Situation

- The old branch `feat/merge-upstream` was far behind `origin/dev`.
- GitHub reported roughly `229` commits ahead and `2547` commits behind.
- Continuing the merge on that branch would have been more expensive than restarting from a fresh `dev` base.

## Branches Created

- `feat/merge-upstream-fresh`
- `feat/merge-work`

## Decision

- Restart from `origin/dev`.
- Keep the old merge branch only as reference.
- Do the actual merge/porting work on `feat/merge-work`.

## Current Comparison

- `feat/merge-work` is currently aligned with `origin/dev`.
- `feat/merge-upstream` still contains the remaining unique commits that may need to be cherry-picked.

## Next Step

- Cherry-pick only the commits from `feat/merge-upstream` that are still relevant.
- Prefer the non-doc fix commits first, then add docs only if they still match the current implementation.
