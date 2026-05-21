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

### `6d2219e00` preserve instance context in async commands

- Status: `covered`
- Upstream files:
  - `packages/opencode/src/cli/cmd/agent.ts`
  - `packages/opencode/src/cli/cmd/github.ts`
- Risk:
  - effect services lose instance context after async boundary
- Notes:
  - local `AppRuntime.runPromise` already wraps effects with `attach(...)`, which injects `InstanceRef` from ALS automatically
  - this is already covered by the local runtime bridge and existing tests around `AppRuntime` + `InstanceRef`
  - upstream patch shape also assumes `effectCmd` in these commands, while the local fork still uses plain `cmd` plus `Instance.provide`

### `4d900b2f4` preserve target attribute in markdown sanitization

- Status: `done`
- Upstream files:
  - `packages/ui/src/components/markdown.tsx`
- Risk:
  - sanitized markdown strips link targets, breaking intended new-tab behavior
- Notes:
  - added `target` to allowed DOMPurify attributes
  - safe UI-only patch

### `836a33198` fix question dock overflow and message part flex layout

- Status: `done`
- Upstream files:
  - `packages/app/src/pages/session/composer/session-question-dock.tsx`
  - `packages/ui/src/components/message-part.css`
- Risk:
  - long question text overflows the dock
  - answer options flex sizing fights the dock layout
- Notes:
  - made question text container scrollable
  - changed question options list from `flex: 1` to `flex-shrink: 0` to avoid layout collapse

### `367665dba` render tagged config errors

- Status: `done`
- Upstream files:
  - `packages/opencode/src/cli/error.ts`
  - `packages/opencode/test/cli/error.test.ts`
- Risk:
  - tagged config errors render poorly or lose structured details in the CLI
- Notes:
  - expanded config error formatting to support both legacy `name + data` and tagged `_tag` error shapes
  - added regression coverage for config json, directory typo, frontmatter, and schema-invalid cases

### `43c24d8d0` gate Zed context on terminal env

- Status: `done`
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/context/editor-zed.ts`
  - `packages/opencode/src/cli/cmd/tui/context/editor.ts`
  - `packages/opencode/test/cli/tui/editor-context-zed.test.ts`
- Risk:
  - non-Zed terminals probe Zed sqlite state unnecessarily
  - false-positive editor context enablement outside Zed
- Notes:
  - adapted only the terminal gating and regression coverage
  - intentionally skipped the unrelated `config-service` refactor from the same upstream commit
  - local TUI now only falls back to Zed DB selection when running inside a Zed terminal

### `8bfa188e0` use colon for collapsed thinking labels

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/feature-plugins/system/session-v2.tsx`
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Risk:
  - completed reasoning still renders as active "thinking"
  - wording mismatch in TUI reasoning labels
- Notes:
  - local fork only had the live reasoning renderer in `routes/session/index.tsx`
  - adapted the safe local subset so completed reasoning uses `_Thought:_` while active reasoning stays `_Thinking:_`
  - upstream collapsed-reasoning text path was not present locally, so there was nothing else to port

### `a6e1aa085` default new sessions always to local project

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
  - `packages/opencode/src/cli/cmd/tui/plugin/api.tsx`
  - `packages/opencode/src/cli/cmd/tui/routes/home.tsx`
  - `packages/plugin/src/tui.ts`
- Risk:
  - new home-screen prompts inherit the currently selected workspace implicitly
  - fresh sessions start in the wrong project context
- Notes:
  - local prompt creation already passes `workspace: props.workspaceID` when `sessionID` is absent
  - adapted the safe local subset by stopping `home.tsx` from injecting the current workspace into the home prompt and related slot
  - left the broader prompt/plugin prop cleanup untouched because the local fork still uses `workspaceID` in other contexts

### `fc0829213` add unknown error references

- Status: `done` with local adaptation
- Upstream files:
  - `packages/core/src/util/error.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/middleware/error.ts`
  - `packages/opencode/test/server/httpapi-error-middleware.test.ts`
- Risk:
  - server 500 responses leak stack traces or internal details
  - no stable error reference for correlating client failures with logs
- Notes:
  - local fork routes errors through the global Hono [server/middleware.ts](/C:/Users/Klaus/Desktop/PFH/opencode/packages/opencode/src/server/middleware.ts) instead of an HttpApi-only middleware
  - adapted the local equivalent: 500 unknown errors now return a safe message plus `ref`, and logs include the same reference id
  - config-special-case removal from upstream was already effectively covered locally because this middleware had no config-specific bypass

### `ddd6eb449` separate question checkmark labels

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/run/footer.question.tsx`
  - `packages/opencode/src/cli/cmd/tui/routes/session/question.tsx`
  - `packages/opencode/test/cli/tui/use-event.test.tsx`
- Risk:
  - single-select checkmarks stick directly to labels in the TUI question prompt
  - stale generic event typings drift from current `GlobalEvent["payload"]` shape
- Notes:
  - local fork only needed the TUI question prompt spacing fix, plus the compatible test typing cleanup already reflected upstream
  - run-footer-specific changes were not ported in this pass

### `f5a8202b4` simplify thinking toggle styling

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/feature-plugins/system/session-v2.tsx`
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Risk:
  - reasoning blocks visually overemphasize the left-border treatment
  - styling drifts from newer TUI reasoning presentation
- Notes:
  - local fork does not have the same collapsed/expanded reasoning UI as upstream in this codepath
  - adapted only the safe local subset: visible reasoning blocks now use the simpler indentation-only styling instead of the extra left border

### `26008696e` surface schema failures as friendly tool errors

- Status: `done`
- Upstream files:
  - `packages/opencode/src/question/index.ts`
  - `packages/opencode/test/question/question.test.ts`
- Risk:
  - invalid question-tool payloads can throw uncaught schema errors
  - assistant turn dies instead of getting a retryable tool error
- Notes:
  - switched `Question.ask` from sync decode to effectful decode with a friendly rewrite hint
  - invalid payloads now reject with a readable tool-facing error message instead of exploding at the decode boundary

### `69eee26f3` drop redundant inner decode in permission ask

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/permission/index.ts`
- Risk:
  - redundant inner decode can throw unexpectedly despite already-typed ask input
  - permission request creation does unnecessary schema work on the hot path
- Notes:
  - local fork kept the existing `Request` class shape, but removed the redundant `decodeUnknownSync` inside `Permission.ask`
  - `Permission.ask` now builds the already-typed request object directly from validated input

### `8fc02b013` tool argument errors at the boundary

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/tool/tool.ts`
  - `packages/opencode/test/tool/tool-define.test.ts`
- Risk:
  - tool parameter schema failures surface as generic errors instead of a typed boundary error
  - model retry flow gets less structured feedback for invalid tool calls
- Notes:
  - introduced a local `Tool.InvalidArgumentsError` and used it at the decode boundary inside tool wrapping
  - added regression coverage that the failure survives as a die defect with the expected friendly rewrite message
