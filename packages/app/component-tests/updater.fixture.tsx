import { Slot, type Context } from "@opencode/plugin/gui"
import type { UpdaterState } from "@opencode/plugin/gui/updater"
import type { Entry } from "@opencode/plugin/gui/host"
import type { Component } from "solid-js"
import { createComponent, createSignal, mountPlugins } from "./plugin-host.fixture"
import "../src/settings/settings.css"

export function mountUpdater(input: {
  definition: Omit<Entry, "id">
  section: Component<{ state: () => UpdaterState; run: () => void }>
}) {
  const [state, set] = createSignal<UpdaterState>({ status: "downloading", version: "2.2.2" })

  const host = mountPlugins({
    definitions: [
      {
        ...input.definition,
        id: "updater",
        windowEntry: async () => ({
          default: (ctx: Context) => {
            ctx.add(Slot, {
              at: "window.bottom",
              render: () => createComponent(input.section, { state, run: () => {} }),
            })
          },
        }),
      },
    ],
  })

  host.release()

  return { ...host, set }
}

export { until } from "./plugin-host.fixture"
