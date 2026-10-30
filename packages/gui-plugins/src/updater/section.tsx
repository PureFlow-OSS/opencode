import { Show, createMemo, type JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { Loader } from "@opencode/ui/loader"
import { usePlugin } from "@opencode/plugin/gui"
import { updaterAction } from "./action"
import type { UpdaterState } from "@opencode/plugin/gui/updater"
import type definition from "./index"
import { progressDescription, progressLabel } from "./progress"

export default function UpdatesSection(props: { state: () => UpdaterState | undefined; run: () => void }) {
  const ctx = usePlugin<typeof definition>()
  const releaseNotes = ctx.stores.releaseNotes
  const action = createMemo(() => updaterAction(props.state()))

  const downloading = createMemo(() => {
    const state = props.state()

    return state?.status === "downloading" ? state : undefined
  })

  const checkDescription = createMemo(() => {
    const state = props.state()

    if (!state) return ctx.t("check.unavailable")

    if (state.status === "disabled") return ctx.t("check.disabled")

    return progressDescription(ctx, state) ?? ctx.t("check.description")
  })

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">{ctx.t("section.title")}</h3>

      <div data-component="settings-list">
        <Row title={ctx.t("releaseNotes.title")} description={ctx.t("releaseNotes.description")}>
          <div data-action="settings-release-notes">
            <Switch
              checked={releaseNotes.value.enabled}
              onChange={(checked) =>
                releaseNotes.update((draft) => {
                  draft.enabled = checked
                })
              }
            />
          </div>
        </Row>

        <Row title={ctx.t("check.title")} description={checkDescription()}>
          <Button
            data-action="settings-check-updates"
            size="normal"
            variant="neutral"
            disabled={!action().run}
            aria-busy={action().busy ?? false}
            onClick={() => props.run()}
          >
            <Show when={action().busy}>
              <Loader class="size-3.5" />
            </Show>
            {progressLabel(ctx, props.state())}
          </Button>
        </Row>
        <Show when={downloading()}>
          {(state) => (
            <div class="px-5 pb-4" data-slot="update-download-progress" role="status" aria-live="polite">
              <div
                class="h-1.5 w-full overflow-hidden rounded-full bg-v2-background-bg-deep"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={state().progress?.percent}
                aria-label={ctx.t("action.downloading")}
              >
                <div class="h-full bg-v2-icon-icon-accent" style={{ width: `${state().progress?.percent ?? 0}%` }} />
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

// The host's settings row markup; its stylesheet is loaded with the settings screen.
function Row(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
      </div>
      <div data-slot="settings-row-control">{props.children}</div>
    </div>
  )
}
