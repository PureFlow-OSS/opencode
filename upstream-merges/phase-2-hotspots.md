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

- Status: `partial`
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
  - local minimal subset adapted on `feat/merge-upstream`: `run` now supports `--replay` and `--replay-limit` for resumed CLI sessions and renders static visible history before the new turn
  - local blocker recovery subset also adapted: resumed CLI runs now list pending permissions and questions for the current session and settle them before the next turn
  - local blocker policy intentionally mirrors current non-interactive `run` behavior:
    - pending permissions are auto-approved only with `--dangerously-skip-permissions`, otherwise auto-rejected
    - pending questions are auto-rejected because local `run` has no interactive answer surface
    - live `question.asked` events are also auto-rejected during non-interactive `run`
  - local duplicate-after-replay subset also adapted: replay now seeds assistant message ids and completed part ids so the first matching `message.updated` / `message.part.updated` events are skipped instead of being printed twice
  - local boot-buffering subset also adapted: the resumed CLI now starts the event stream before blocker settlement/replay, buffers same-session events during boot, then drains them after replay so early live events are not handled out of order against the restored scrollback
  - local delta-suppression subset also adapted for replayed text/reasoning parts: replay snapshots now retain completed part text and skip matching `message.part.delta` suffixes that would otherwise duplicate already replayed output
  - local role-buffering subset also adapted: visible text/reasoning output now waits for `message.updated` role confirmation before printing, so user-role message parts are dropped instead of being echoed back during non-interactive resume
  - local streamed-part merge subset also adapted: `message.part.delta` text is now retained across resume and merged back into later `message.part.updated` payloads so shorter update payloads cannot truncate visible assistant/reasoning output
  - local question-recovery subset also adapted: if a running `question` tool does not surface a matching `question.asked` event, non-interactive `run` now polls `sdk.question.list()` for the current session and auto-rejects recovered questions instead of hanging indefinitely
  - duplicate replayed `message.part.updated` events now also clear local buffered text state for completed text/reasoning parts, preventing stale carry-over after resume
  - local live-stream subset also adapted: default-format non-interactive `run` now writes assistant/reasoning chunks incrementally from `message.part.delta` / merged `message.part.updated` state instead of waiting for the final `time.end` payload
  - local bash-echo subset also adapted: completed bash tool output is now stashed and stripped from the beginning of the next assistant text chunk, reducing duplicated shell output in streamed resumes
  - local idle-handoff subset also adapted:
    - stale pre-turn `session.status idle` events no longer terminate the event loop before the new turn has produced any live session activity
    - idle completion now re-checks live `sdk.session.status()` before breaking, reducing delayed-idle races from older turns
  - local failure-exit subset also adapted: background SSE subscription now aborts when `sdk.session.prompt(...)` / `sdk.session.command(...)` returns an immediate error, so non-interactive resumed runs do not hang on a failed turn
  - boot-time blocker replies are deduped against already settled pending blockers so buffered `permission.asked` / `question.asked` events do not trigger double replies during resume
  - local child-session tracking subset also adapted: `task` tool metadata now seeds tracked subagent session ids during replay and live updates, so resumed non-interactive `run` also auto-rejects pending/live child-session permissions and questions instead of only watching the root session
  - local child-session error subset also adapted: tracked subagent `session.error` events now surface in CLI output with a `subagent <sessionID>` prefix instead of being silently ignored
  - deferred pieces remain the hardest upstream-only parts: deeper streamed-part rendering parity, subagent recovery, and footer/runtime state sync

### `22a5e6cc5` restore non-interactive run exit behavior

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/run.ts`
- Risk:
  - non-interactive `run` can hide prompt or command request failures until after the event loop
  - CLI can exit successfully even when the request itself returned an immediate structured error
- Notes:
  - local `run.ts` now checks the direct result of `sdk.session.command(...)` and `sdk.session.prompt(...)` in non-interactive mode
  - structured request failures are formatted through existing CLI error formatting and set `process.exitCode = 1`
  - local event stream now aborts on immediate turn failure and successful turn starts await loop completion again, so stream-side errors still affect exit behavior

### `94564f358` prevent double auto-compaction after `filterCompacted` reorder

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/session/message-v2.ts`
  - `packages/opencode/src/session/prompt.ts`
- Risk:
  - compaction-reordered message arrays can make `prompt.loop` pick the wrong "latest" user/assistant markers
  - auto-compaction can trigger twice because the retained tail assistant is mistaken for the newest completed turn
- Notes:
  - added local `MessageV2.latest(...)` helper that derives latest user, latest assistant, latest finished assistant, and pending task parts by maximum message id instead of relying on array position
  - updated `prompt.ts` to use the helper after `filterCompactedEffect(...)`
  - added regression coverage for the compaction-reordered case where the retained tail sits between the summary pair and the newest user turn

### `cb3549324` acquire PubSub subscription eagerly to close `/event` race

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/bus/index.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts`
- Risk:
  - publishes can be lost between `yield*`/route setup and first stream pull
  - `/event` SSE can miss events that happen during the `Stream.concat(initial, subscribe)` handoff window
- Notes:
  - adapted the eager-subscription subset only: `Bus.Service.subscribe(...)` and `subscribeAll(...)` now acquire the underlying `PubSub` subscription in caller scope at `yield*` time
  - updated local effect-native call sites in plugin hooks, share cache listeners, VCS branch watcher, and HttpApi event route
  - added regression coverage for both direct `subscribe(...)` buffering and the `/event`-style concat-prefix handoff
  - local follow-up: plugin hook fanout stayed on `subscribeAllCallback(...)` because the current plugin state init path is not fully `scoped` and otherwise stalled loader tests on this fork

### `40e73c491` structured invalid request errors on HttpApi routes

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/server/routes/instance/httpapi/session.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/provider.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/mcp.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/experimental.ts`
- Risk:
  - invalid query/payload cases leaking generic 500s
  - inconsistent 400 bodies across HttpApi routes
  - session route regressions hidden behind stricter id schema
- Notes:
  - added local `InvalidRequestHttpApiError` helper in `handlers/request-errors.ts`
  - provider OAuth, MCP OAuth, and Console org switch now return structured `InvalidRequestError` bodies for user-caused bad requests
  - `session.messages` now returns explicit 400 JSON responses for missing `limit` on `before` and for malformed cursors, because local mixed-error schema mapping dropped the 400 status on this fork
  - `session.deletePart` now pre-checks part existence before delete so missing parts return 404 instead of silently succeeding
  - session read routes (`get`, `message`, `messages` session precheck) now use the same promise-side `mapNotFoundError(...)` bridge as the already working mutation routes, avoiding defect-style `NotFoundError` leaks from local session service code
  - local regression coverage also switched `missing-*` route tests to valid branded ids, because current upstream/dev id schema rejects arbitrary strings before route logic runs

### `fed043a1a` + `f01c6b3e3` typed message lookup wrappers and message list not-found errors

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/session/message-v2.ts`
  - `packages/opencode/src/session/session.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/revert.ts`
  - `packages/opencode/src/session/summary.ts`
- Risk:
  - sync message helpers throwing plain defects instead of typed not-found errors
  - `Session.messages` / `findMessage` bypassing typed pagination and hiding missing-session cases
  - callers assuming session existence without making that assumption explicit
- Notes:
  - added local `MessageV2.pageEffect(...)` and `MessageV2.getEffect(...)` wrappers that preserve `NotFoundError` as typed failure and die on unexpected defects
  - `Session.messages(...)` and `Session.findMessage(...)` now page through `pageEffect(...)` instead of raw sync generators, so missing sessions stay in the typed error channel
  - local callers that logically require an existing session now make that assumption explicit with `.pipe(Effect.orDie)` in `prompt`, `revert`, and `summary`
  - local `session.messages` HttpApi route now bridges paged message lookups through the same `mapNotFoundError(...)` pattern as other session read routes, so `limit` pagination no longer leaks raw storage/session not-found errors
  - follow-up local call-sites also moved onto the wrappers:
    - `tool/task.ts` now resolves the parent assistant message via `getEffect(...).pipe(Effect.orDie)`
    - legacy Hono session routes now use `pageEffect(...)` / `getEffect(...)` instead of raw sync reads
  - added regression coverage for `pageEffect(...)` and `getEffect(...)` not-found behavior in `messages-pagination.test.ts`

### `5911bd532` show config error details on startup

- Status: `done` with local partial adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/context/aggregate-failures.ts`
  - `packages/opencode/src/cli/error.ts`
- Risk:
  - startup/config failures collapse into generic transport errors
  - nested config validation bodies from SDK/client calls lose their useful details in the TUI
- Notes:
  - local fork does not have the same `aggregate-failures.ts` structure, but `app.tsx` already routes startup errors through `FormatError(...)`
  - adapted the compatible core subset in `cli/error.ts`: nested `Error.cause.body` payloads are now recursively formatted, especially for config validation/json errors
  - added regression coverage that wrapped config bodies surface path + issue details instead of only the outer error label

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

### `c64ac905e` dedupe concurrent Codex OAuth refreshes

- Status: `done`
- Upstream files:
  - `packages/opencode/src/plugin/codex.ts`
  - `packages/opencode/test/plugin/codex.test.ts`
- Risk:
  - concurrent Codex requests can race a token refresh and issue duplicate refresh calls
  - auth state can churn unnecessarily under parallel request load
- Notes:
  - added a shared in-flight refresh promise inside the OAuth fetch wrapper
  - also exposed injectable issuer/API endpoint options for deterministic test coverage of the refresh path

### `4487fbf52` support PDF attachments for xAI/Grok

- Status: `done` with local adaptation
- Upstream files:
  - `package.json`
  - `packages/opencode/src/session/message-v2.ts`
  - `patches/@ai-sdk%2Fxai@3.0.82.patch`
- Risk:
  - tool-result attachments for xAI/Grok can send unsupported PDFs inline
  - PDF attachments can fail later in the xAI responses adapter even though image attachments work
- Notes:
  - adapted local `message-v2.ts` to use MIME-aware tool-result attachment support instead of a single provider-wide boolean
  - xAI and Bedrock now keep image tool-result attachments inline but replay unsupported PDFs as synthetic user file inputs
  - added the upstream-style `@ai-sdk/xai@3.0.82` patch so `application/pdf` user file parts map to `input_file`
  - verified with targeted `session/message-v2` regression coverage; no session-loading paths touched

### `82b796ce3` return session busy error bodies

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/session-errors.ts`
  - `packages/opencode/test/server/httpapi-session.test.ts`
- Risk:
  - busy experimental session routes collapse into generic failures
  - clients cannot distinguish retryable busy state from malformed requests
- Notes:
  - local fork still keeps the experimental HttpApi session surface in one file, but the busy-error helper now also follows the upstream `handlers/session-errors.ts` split
  - added a local `SessionBusyHttpApiError` with `409` status and mapped busy promise rejections on the affected routes: `shell`, `revert`, `unrevert`, and `deleteMessage`
  - session route imports now use the extracted helper module, which reduces `session.ts` surface area and makes later HttpApi error ports easier
  - added regression coverage for the busy-error mapping helper and kept the existing HttpApi session route suite green

### `b275b12e9` expose session not found errors

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/server/routes/instance/httpapi/groups/v2/session.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/v2/session.ts`
  - `packages/opencode/test/server/httpapi-session.test.ts`
- Risk:
  - missing sessions/messages collapse into generic 500s
  - clients cannot distinguish retryable/server faults from missing resources
- Notes:
  - local fork does not yet share the upstream `groups/v2/session.ts` shape, so the intent was adapted onto the existing experimental session HttpApi surface
  - extracted `mapNotFoundError(...)` and `mapSessionRouteError(...)` into `handlers/session-errors.ts`
  - added explicit `404` route metadata and mapping on key session routes including `get`, `messages`, `message`, `remove`, `update`, `fork`, `share`, `unshare`, `summarize`, `deleteMessage`, `deletePart`, and `updatePart`
  - added route-level regression checks for missing session/message/part responses in the existing Hono bridge session test

### `c79a9634d` tolerate plugin tool defs with missing args

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/tool/registry.ts`
  - `packages/opencode/test/tool/registry.test.ts`
- Risk:
  - malformed custom/plugin tools with `args: undefined` can crash registry init
  - one broken tool can poison the whole tool list
- Notes:
  - local registry now normalizes missing plugin/custom tool args to `{}` before building the Zod wrapper
  - this preserves the older tolerant behavior where no-args tools still register instead of crashing the registry

### `cb511f78f` preserve tool attachments from plugin/custom tools

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/tool/registry.ts`
  - `packages/opencode/test/tool/registry.test.ts`
  - `packages/plugin/src/tool.ts`
- Risk:
  - structured custom tool results lose attachments at the registry boundary
  - plugin tools can return output text but silently drop file payloads
- Notes:
  - local plugin tool result type now allows optional `title` and `attachments`
  - local tool registry now forwards those structured fields instead of collapsing everything to plain output + metadata
  - verified with `bun typecheck` in `packages/plugin` and `packages/opencode`

### `233fc5b91` preserve assistant message content when signed reasoning blocks are present

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/session/message-v2.ts`
  - `packages/opencode/test/session/message-v2.test.ts`
- Risk:
  - replayed assistant turns with signed Anthropic/Bedrock reasoning can lose structural separators
  - provider regrouping can shift signed reasoning/text positions and break downstream validation
- Notes:
  - local `message-v2.ts` now substitutes `" "` for empty assistant text separators when same turn contains signed Anthropic or Bedrock reasoning
  - keeps replay/grouping positions stable without changing unsigned reasoning or ordinary assistant text behavior
  - verified with `bun typecheck` in `packages/opencode`

### `c6e6bdf59` tolerate negative token counts in stored parts

- Status: `done` with local partial adaptation
- Upstream files:
  - `packages/opencode/src/session/message-v2.ts`
  - `packages/opencode/src/session/message.ts`
  - `packages/opencode/src/session/session.ts`
  - `packages/opencode/src/v2/session-event.ts`
- Risk:
  - derived token math can go negative with legacy or malformed provider usage payloads
  - negative token counts can propagate into persisted assistant parts and cost display
- Notes:
  - local schemas already tolerate numeric token values broadly, so upstream schema widening was effectively already covered
  - adapted missing runtime piece: `getUsage(...)` now clamps finite negative derived token counts back to `0`
  - verified with `bun typecheck` in `packages/opencode`

### `20cec9155` restore model suggestions

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/provider/provider.ts`
  - `packages/opencode/test/provider/provider.test.ts`
- Risk:
  - disabled or auth-missing providers disappear from active state, so model lookup errors lose useful suggestions
  - partially loaded provider catalogs can suggest wrong provider IDs but no model IDs
- Notes:
  - local provider state now keeps raw `catalog` alongside active `providers`
  - `ModelNotFoundError` suggestions now fall back to catalog models/providers, filtering deprecated and hidden alpha models same as upstream intent
  - verified with `bun typecheck` in `packages/opencode`

### `1cf8123bc` align GPT-5 reasoning variants

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/provider/transform.ts`
  - `packages/opencode/test/provider/transform.test.ts`
- Risk:
  - GPT-5 family variants drift across `gpt-5`, `gpt-5.1+`, `codex`, `pro`, and `chat`, causing bad default efforts or unsupported controls
  - OpenAI-compatible and gateway providers can expose wrong reasoning tiers for newer GPT-5 variants
- Notes:
  - local provider transform now derives GPT-5 effort tiers from model family/version, including `pro`, `chat`, and `codex` exceptions
  - small-model defaults now avoid forcing unsupported reasoning on `gpt-5-chat` and `search-api` variants

### `c36ab3f93` align Gemini thinking controls

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/provider/transform.ts`
  - `packages/opencode/test/provider/transform.test.ts`
- Risk:
  - Gemini 2.5/3 reasoning controls differ by family and image/flash/pro variants, so static defaults can send unsupported `thinkingLevel` or wrong budget caps
- Notes:
  - local provider transform now computes Gemini thinking levels and max budgets from model ID instead of using single hardcoded defaults
  - Google small-model defaults now choose `thinkingLevel` or `thinkingBudget` per family

### `319498e2f` constrain OpenAI deep research efforts

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/provider/transform.ts`
- Risk:
  - deep-research models reject broader GPT-5 effort matrix, so generic OpenAI effort expansion can send invalid controls
- Notes:
  - local OpenAI effort derivation now special-cases `deep-research` models to `medium` only

### `e0396b809` align Anthropic Opus 4.5 efforts

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/provider/transform.ts`
- Risk:
  - Opus 4.5 does not use same adaptive/max shape as newer Anthropic families, so generic fallback can advertise wrong effort controls
- Notes:
  - local Anthropic variant generation now maps Opus 4.5 to plain `low|medium|high` effort variants

### `12ae22378` bridge plugin tool ask promises

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/tool/registry.ts`
  - `packages/plugin/src/tool.ts`
- Risk:
  - plugin tools run outside host Effect world and can lose context or hang if `ask(...)` crosses boundary as raw Effect
- Notes:
  - local plugin `ToolContext.ask(...)` now returns `Promise<void>`
  - local tool registry bridges host `toolCtx.ask(...)` through `EffectBridge` before exposing it to plugins

### `ef7d80127` preserve custom tool arg descriptions

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/tool/registry.ts`
  - `packages/plugin/src/tool.ts`
- Risk:
  - converting plugin/custom tool args to JSON Schema later can drop Zod `.describe()` metadata and weaken tool guidance
- Notes:
  - plugin tools now precompute `jsonSchema` from their original Zod instance
  - local tool registry prefers plugin-supplied schema and only falls back to local conversion when needed
  - verified with `bun typecheck` in `packages/plugin` and `packages/opencode`

### `ff9d7cab5` fix file references in workspaces

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/component/dialog-tag.tsx`
  - `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx`
- Risk:
  - file search mentions can leak across workspaces and suggest wrong files when TUI is pointed at non-default project
- Notes:
  - local TUI file lookups now pass current workspace into `sdk.client.find.files(...)`

### `d353a6bc2` accept missing worktree create payload

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/server/routes/instance/httpapi/experimental.ts`
- Risk:
  - clients posting `/experimental/worktree` without JSON body can fail schema decode before handler sees optional payload
- Notes:
  - local route now uses `disableCodecs: true` plus `Schema.UndefinedOr(Worktree.CreateInput)` to accept empty-body create requests
  - verified with `bun typecheck` in `packages/opencode`

### `564cde393` copy pasted prompt content

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
  - `packages/opencode/src/cli/cmd/tui/component/prompt/part.ts`
  - `packages/opencode/src/cli/cmd/tui/util/selection.ts`
- Risk:
  - copying prompt text from TUI can preserve placeholder markers instead of actual pasted text payloads
- Notes:
  - local textarea selection copy now lets prompt renderables expand placeholder extmarks back to original pasted text before clipboard write
  - verified with `bun typecheck` in `packages/opencode`

### `4b496066b` update spinner color logic

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- Risk:
  - active spinner can inherit currently selected agent color instead of agent tied to last user turn, making in-flight status misleading after agent switches
- Notes:
  - local spinner color now prefers last user message agent while session is active, then falls back to current agent when idle
  - verified with `bun typecheck` in `packages/opencode`

### `c2ffd7cf1` markdown table rendering

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Risk:
  - markdown tables can render poorly in session view without explicit grid table styling
- Notes:
  - local session markdown renderer now passes `tableOptions={{ style: "grid" }}`
  - verified with `bun typecheck` in `packages/opencode`

### `611e48c4a` collapse long tool output lines

- Status: `done` with local partial adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
  - `packages/opencode/src/cli/cmd/tui/util/collapse-tool-output.ts`
- Risk:
  - tool output can fit within line-count caps but still explode horizontal width, making session view noisy and hard to scan
- Notes:
  - local session route now uses shared `collapseToolOutput(...)` helper for generic tool blocks and shell output
  - helper collapses on both line count and approximate character budget derived from current width
  - verified with `bun typecheck` in `packages/opencode`

### `f3b0d3d7a` dedupe consecutive prompt history entries

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/component/prompt/history.tsx`
- Risk:
  - repeated identical submits spam local prompt history and make arrow navigation noisy
- Notes:
  - local prompt history now skips appending an entry when it matches the latest stored item byte-for-byte
  - verified with `bun typecheck` in `packages/opencode`

### `af06e5270` ignore instruction lookup errors

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/session/instruction.ts`
- Risk:
  - broken or inaccessible upward config lookup can fail whole instruction resolution chain and break session boot/prompt prep
- Notes:
  - local `findUp(...)` project-instruction scan now degrades to empty matches on lookup failure instead of failing whole request
  - verified with `bun typecheck` in `packages/opencode`

### `aa07e2194` handle undefined tips

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx`
- Risk:
  - home tips memo can expose transient undefined value and crash parse/render path during initial evaluation
- Notes:
  - local home tips view now carries explicit fallback tip string and parsed fallback parts
  - verified with `bun typecheck` in `packages/opencode`

### `c0a8b509c` distinguish markdown h1 headings

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/context/theme.tsx`
- Risk:
  - h1 headings can visually blend into lower heading levels in markdown-heavy session output
- Notes:
  - local `markup.heading.1` syntax scope now adds underline on top of existing bold heading styling
  - verified with `bun typecheck` in `packages/opencode`

### `e94aecaa0` contrast-aware paste summary badge

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/context/theme.tsx`
- Risk:
  - paste summary extmarks can become unreadable on themes where warning background and default background-adjacent foreground clash
- Notes:
  - local `extmark.paste` style now derives foreground via `selectedForeground(theme, theme.warning)`
  - verified with `bun typecheck` in `packages/opencode`

### `0beb4de3e` expose MCP server not found errors

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/server/routes/instance/httpapi/mcp.ts`
- Risk:
  - unknown MCP names can currently fall through to invalid request or silent no-op behavior, which makes client retries and error handling ambiguous
- Notes:
  - local MCP HttpApi routes now guard action endpoints with a status-backed server existence check
  - unknown server names now return `HttpApiError.NotFound` for auth, connect, disconnect, and auth removal/callback routes
  - verified with `bun typecheck` and `bun test test/server/httpapi-mcp.test.ts` in `packages/opencode`

### `3e1972fd9` expose project not found errors

- Status: `done` with local adaptation
- Upstream files:
  - `packages/opencode/src/project/project.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/project.ts`
- Risk:
  - patching a missing project currently degrades to a generic server error instead of a stable client-visible 404
- Notes:
  - local `Project.update(...)` now fails with typed `NotFoundError`
  - project HttpApi `update` maps the typed error to `HttpApiError.NotFound`
  - verified with `bun typecheck` and `bun test test/server/httpapi-instance.test.ts -t "returns not found for missing project update"` in `packages/opencode`

### `4ce247eab` expose request not found errors

- Status: `done` with local partial adaptation
- Upstream files:
  - `packages/opencode/src/server/routes/instance/httpapi/permission.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/question.ts`
- Risk:
  - replying to already cleared or unknown permission/question requests currently no-ops, which hides stale UI races and makes API retries ambiguous
- Notes:
  - local `permission` and `question` reply/reject routes now precheck pending requests and return structured `RequestNotFoundError` `404` bodies
  - shared helper lives in `handlers/request-errors.ts`
  - verified with `bun typecheck` and `bun test test/server/httpapi-requests.test.ts` in `packages/opencode`

### `5cf597d58` expose PTY not found error bodies

- Status: `done` with local partial adaptation
- Upstream files:
  - `packages/opencode/src/server/routes/instance/httpapi/pty.ts`
- Risk:
  - missing PTY sessions currently mix naked `404` responses and silent success on remove, which makes reconnect/retry flows brittle
- Notes:
  - local PTY HttpApi now returns structured `PtyNotFoundError` bodies for `get`, `update`, `remove`, and pre-upgrade `connect`
  - verified with `bun typecheck` and `bun test test/server/httpapi-pty.test.ts` in `packages/opencode`

### `f01c6b3e3` tolerate stale sessions in stats aggregation

- Status: `done` with local partial adaptation
- Upstream files:
  - `packages/opencode/src/cli/cmd/stats.ts`
- Risk:
  - stats aggregation can hard-fail if a session row still exists while its message storage was already removed or migrated away
- Notes:
  - local `stats` now catches `NotFoundError` from `svc.messages(...)` and treats that session as empty instead of aborting the whole report
  - verified with `bun typecheck` in `packages/opencode`

### `d5f397a2d` open external editor in worktree cwd

- Status: `done`
- Upstream files:
  - `packages/opencode/src/cli/cmd/tui/util/editor.ts`
  - `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Risk:
  - external editor launches from process cwd instead of active project/worktree, so relative paths and editor session state can target wrong workspace
- Notes:
  - local `Editor.open(...)` now accepts optional `cwd`
  - prompt editor and session transcript editor now pass `project.instance.path().worktree || project.instance.directory() || process.cwd()`
  - verified with `bun typecheck` in `packages/opencode`

### `5f4235115` type default model failures

- Status: `done` with local partial adaptation
- Upstream files:
  - `packages/opencode/src/provider/provider.ts`
  - `packages/opencode/test/provider/provider.test.ts`
- Risk:
  - `defaultModel()` can fail with generic runtime errors when config excludes all providers or selected provider has no models
  - generic failures are harder to map cleanly at server boundary
- Notes:
  - local provider now throws typed `ProviderNoProvidersError` and `ProviderNoModelsError`
  - server middleware maps both errors to `400`
  - verified with `bun typecheck` and targeted `bun test test/provider/provider.test.ts -t "defaultModel returns typed error when config excludes every provider" --timeout 20000` in `packages/opencode`

### `748fcb7eb` exclude orphaned interrupted tools from run-loop continuation

- Status: `done`
- Upstream files:
  - `packages/opencode/src/session/prompt.ts`
- Risk:
  - cleanup-marked interrupted tool parts can look like pending tool work and force an unnecessary continuation loop
  - resumed or retried sessions can keep spinning instead of exiting cleanly
- Notes:
  - local prompt loop now ignores tool parts with `state.status === "error"` and `state.metadata?.interrupted === true` when deciding whether another loop pass is needed
  - local loop also logs orphaned interrupted tool metadata before exiting
  - verified with `bun typecheck` in `packages/opencode`
