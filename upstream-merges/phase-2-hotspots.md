# Phase 2 Hotspots

## Status legend

- `covered`: current fork already covers upstream fix
- `pending`: needs manual adaptation
- `done`: adapted on `feat/merge-upstream`

## Hotspots

### `e524e2785` Guard project lookups during layout boot

- Status: `covered`
- Upstream files:
  - `packages/app/src/context/layout.tsx`
  - `packages/app/src/context/sync.tsx`
  - `packages/app/src/pages/layout.tsx`
- Notes:
  - current branch already contains stricter startup guards around layout boot
  - current layout flow also has later additions like `pageReady`, `layoutReady`, guarded startup restore, and safer project access patterns
  - no additional code patch applied in Phase 2 for this hotspot

### `88dc5995c` Guard stale sessions and projects during startup

- Status: `covered`
- Upstream files:
  - `packages/app/src/components/dialog-select-directory.tsx`
  - `packages/app/src/components/session/session-new-view.tsx`
  - `packages/app/src/context/global-sync/session-trim.ts`
  - `packages/app/src/context/server.tsx`
  - `packages/app/src/pages/home.tsx`
  - `packages/app/src/pages/layout.tsx`
  - `packages/app/src/pages/layout/helpers.ts`
- Risk:
  - startup state
  - stale project/session references
  - empty states and recent-session visibility
- Notes:
  - current branch already contains the null-safe time reads and filtered project/worktree handling from this hotspot
  - current branch also already has stronger startup guards in layout and home loading states
  - no additional code patch needed

### `0d6ff4252` Fix boot flicker while loading projects

- Status: `covered`
- Upstream files:
  - `packages/app/src/pages/home.tsx`
  - `packages/app/src/pages/layout.tsx`
  - `packages/desktop-electron/src/renderer/index.tsx`
- Risk:
  - UI flicker during initial project boot
- Notes:
  - current `home.tsx` already uses the later stricter loading/empty-state split from newer upstream work, so the temporary grace-delay patch from this commit is superseded
  - current `layout.tsx` already gates sidebar empty states on `pageReady`, `layoutReady`, `server.ready`, `globalSync.ready`, and `!autoselecting.loading`
  - current renderer already does not contain the removed `root?.replaceChildren()` call
  - no additional code patch needed for this hotspot

### `ced906301` Delay empty states until autoselect settles

- Status: `covered`
- Upstream files:
  - `packages/app/src/context/global-sync/bootstrap.ts`
  - `packages/app/src/pages/home.tsx`
  - `packages/app/src/pages/layout.tsx`
- Risk:
  - false empty states during startup/autoselect
- Notes:
  - current `home.tsx` and `layout.tsx` already match the later safer behavior by waiting on readiness and autoselect completion before showing empty states
  - current `layout.tsx` also awaits startup restore navigation, which is stricter than the intermediate upstream state
  - upstream removal of `waitForPaint()` in `bootstrap.ts` is intentionally not adapted because our bootstrap/session-loading path diverges and this spot is too close to prior session regressions
  - no additional code patch applied for this hotspot

### `d7b7be190` Path mismatches cause sessions missing + strong ID + existing data fix

- Status: `covered`
- Overlapping local commits:
  - `1120c10b1` `Fix session loading after restart`
  - `102fa2283` `Load all sessions and messages again`
- Notes:
  - current branch already contains equivalent path normalization and legacy persisted-storage migration
  - covered areas include `pathKey`, workspace/session storage migration, queue dedupe by normalized directory key, and child-store key normalization
  - no code patch applied in Phase 2 for this hotspot

### `fc19dcc70` sort v2 session list by updated time

- Status: `done` for app-side ordering
- Risk:
  - ordering mismatch between app trimming/listing and server v2 session list
- Notes:
  - app-side root-session ordering patched by restoring `roots.sort(compareSessionRecent)` in `session-trim.ts`
  - backend/v2 route changes are still intentionally deferred because local server architecture diverges heavily from upstream

### `f179dcbf0` only run `session.updated` archive logic if archive state changes

- Status: `done`
- Risk:
  - event reducer churn
  - accidental archive-related regressions
- Notes:
  - patched app event reducer with a safe guard
  - short-circuit only when session exists locally and archived state already matches incoming event

### `2932a7a35` invalidate provider queries after config update

- Status: `done`
- Upstream files:
  - `packages/app/src/context/global-sync.tsx`
- Risk:
  - provider list stale after config changes
  - custom providers not showing immediately
- Notes:
  - patched local `updateConfig` flow to invalidate global and per-directory provider queries after successful config update
  - safe to adapt because it stays in app query/cache orchestration and does not alter session loading logic

### `b396b71c6` guard reasoning renderer against undefined text

- Status: `done`
- Upstream files:
  - `packages/ui/src/components/message-part.tsx`
- Risk:
  - UI crash when reasoning part text is absent
- Notes:
  - patched `ReasoningPartDisplay` to coerce missing text to an empty string before trimming
  - safe UI hardening with no session/backend interaction

### `66d409d67` update imported session directory/path fields

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/import.ts`
- Risk:
  - imported sessions bound to stale source project/directory
  - session visibility mismatch after import
- Notes:
  - adapted the safe local subset: imported sessions now always overwrite `projectID` and `directory` with the current instance context
  - also update `directory` on conflict for re-imports of the same session id
  - upstream `path` handling was intentionally not ported because the local fork removed the session `path` column and no longer stores it in `Session.Info`

### `e94d46af8` resolve agent and command names from relative paths

- Status: `done`
- Upstream files:
  - `packages/opencode/src/config/agent.ts`
  - `packages/opencode/src/config/command.ts`
  - `packages/opencode/src/config/entry-name.ts`
  - `packages/opencode/test/config/entry-name.test.ts`
- Risk:
  - config entries mis-keyed when parent path segments contain `agent`, `agents`, `command`, or `commands`
  - wrong agent/command names loaded from nested config directories
- Notes:
  - adapted upstream relative-path approach and anchored prefix stripping at the scanned directory
  - added regression coverage for basename fallback, nested keys, Windows separators, and parent-segment false matches

### `9324ef0d0` default console login url

- Status: `done`
- Upstream files:
  - `packages/opencode/src/cli/cmd/account.ts`
  - `packages/opencode/test/cli/account.test.ts`
- Risk:
  - CLI login flow requires an unnecessary URL argument
  - wrong default target for console auth
- Notes:
  - adapted upstream default URL constant and made the login URL positional optional
  - local CLI now defaults to `https://console.opencode.ai` when no URL is passed

### `c035c35eb` tolerate invalid OPENCODE_PERMISSION JSON

- Status: `done`
- Upstream files:
  - `packages/opencode/src/config/config.ts`
  - `packages/opencode/test/config/config.test.ts`
- Risk:
  - malformed `OPENCODE_PERMISSION` env var crashes config startup
- Notes:
  - wrapped env-var JSON parsing in a local `try/catch` and skip invalid values with a warning
  - added regression coverage that config loading returns instead of throwing on malformed JSON

### `5970c12d9` replay session history on interactive resume

- Status: `pending`
- Upstream files:
  - `packages/opencode/src/cli/cmd/run.ts`
  - `packages/opencode/src/cli/cmd/run/runtime.ts`
  - `packages/opencode/src/cli/cmd/run/session-replay.ts`
  - `packages/opencode/src/cli/cmd/run/session.shared.ts`
  - `packages/opencode/src/cli/cmd/run/stream.transport.ts`
  - `packages/opencode/src/cli/cmd/run/subagent-data.ts`
  - `packages/opencode/src/cli/cmd/run/types.ts`
- Risk:
  - session resume rendering
  - duplicate streamed text
  - question/permission blocker state
  - subagent tab recovery
- Notes:
  - upstream implementation depends on a modularized `run/` stack that the local fork does not have yet
  - direct port would require invasive refactor of the monolithic local `packages/opencode/src/cli/cmd/run.ts`
  - safest next step is a local minimal replay design or a prior `run` refactor, not a wholesale transplant
