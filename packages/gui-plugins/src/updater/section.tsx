import { Show, createMemo, type JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { Spinner } from "@opencode/ui/spinner"
import { usePlugin } from "@opencode/plugin/gui"
import { updaterAction } from "./action"
import type { UpdaterState } from "@opencode/plugin/gui/updater"
import type definition from "./index"

export default function UpdatesSection(props: { state: () => UpdaterState | undefined; run: () => void }) {
  const ctx = usePlugin<typeof definition>()
  const releaseNotes = ctx.stores.releaseNotes
  const action = createMemo(() => updaterAction(props.state()))

  const checkDescription = createMemo(() => {
    const state = props.state()

    if (!state) return ctx.t("check.unavailable")

    if (state.status === "disabled") return ctx.t("check.disabled")

    return ctx.t("check.description")
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
              <Spinner class="size-3.5" />
            </Show>
            {ctx.t(action().label)}
          </Button>
        </Row>
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
