import { Button } from "@opencode/ui/button"
import { Spinner } from "@opencode/ui/spinner"
import { Markdown } from "@opencode/session-ui/markdown"
import { createSignal, Show } from "solid-js"
import { createLatest, usePlugin, type IpcClient } from "@opencode/plugin/gui"
import type { Updater } from "@opencode/plugin/gui/updater"
import type definition from "./index"

export default function ChangelogPage(props: { updater: IpcClient<typeof Updater.spec> }) {
  const ctx = usePlugin<typeof definition>()
  const [revision, setRevision] = createSignal(0)

  const active = () => props.updater.state() !== undefined

  const notes = createLatest(
    () => (active() ? revision() : undefined),
    (_, signal) => props.updater.changelog({ signal }),
  )

  const content = () => (active() ? notes.latest?.content : undefined)

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{ctx.t("changelog.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{ctx.t("changelog.description")}</span>
          </div>
          <Button
            variant="neutral"
            disabled={!active() || notes.loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            {ctx.t("changelog.refresh")}
          </Button>
        </div>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned">
        <Show when={!active()}>
          <p role="status" class="text-14-regular text-text-weak">
            {ctx.t("changelog.unavailable")}
          </p>
        </Show>
        <Show when={notes.loading}>
          <div role="status" class="flex items-center gap-2 text-14-regular text-text-weak">
            <Spinner />
            {ctx.t("changelog.loading")}
          </div>
        </Show>
        <Show when={notes.error}>
          <p role="alert" class="text-14-regular text-text-weak">
            {ctx.t("changelog.failed")}
          </p>
        </Show>
        <Show when={content()}>
          {(text) => (
            <div class="rounded-lg bg-surface-base p-4">
              <Markdown text={text()} />
            </div>
          )}
        </Show>
        <Show when={active() && !notes.loading && !notes.error && content() === ""}>
          <p role="status" class="text-14-regular text-text-weak">
            {ctx.t("changelog.empty")}
          </p>
        </Show>
      </div>
    </>
  )
}
