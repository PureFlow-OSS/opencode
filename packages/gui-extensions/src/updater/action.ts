import type { UpdaterState } from "./contract"

/** The one update action the settings row and the titlebar pill offer for a state. */
export function updaterAction(state: UpdaterState | undefined) {
  if (!state) return { label: "action.unavailable" as const }

  switch (state.status) {
    case "checking":
      return { label: "action.checking" as const, busy: true }
    case "downloading":
      return { label: "action.downloading" as const, busy: true }
    case "ready":
      return { label: "action.installRestart" as const, run: "install" as const }
    case "download-required":
      return { label: "action.download" as const, run: "install" as const }
    case "installing":
      return { label: "action.installing" as const, busy: true }
    case "disabled":
      return { label: "action.disabled" as const }
    default:
      return { label: "action.checkNow" as const, run: "check" as const }
  }
}
