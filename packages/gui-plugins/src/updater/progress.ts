import type { Context } from "@opencode/plugin/gui"
import type { UpdaterState } from "@opencode/plugin/gui/updater"
import { updaterAction } from "./action"

/** Shared localized transfer copy for the settings row and the always-present update indicator. */
export function progressLabel(ctx: Pick<Context, "t" | "locale">, state: UpdaterState | undefined) {
  if (state?.status !== "downloading") return ctx.t(updaterAction(state).label)
  const progress = state.progress

  if (progress?.phase === "verify") return ctx.t("download.verifying")

  if (progress?.phase === "unpack") return ctx.t("download.unpacking")

  if (progress?.percent === undefined) return ctx.t("action.downloading")

  return ctx.t("download.percent", {
    percent: new Intl.NumberFormat(ctx.locale.locale(), { maximumFractionDigits: 0 }).format(progress.percent),
  })
}

export function progressDescription(ctx: Pick<Context, "t" | "locale">, state: UpdaterState | undefined) {
  if (state?.status !== "downloading") return undefined

  if (state.progress?.phase === "verify") return ctx.t("download.verifyDescription")

  if (state.progress?.phase === "unpack") return ctx.t("download.unpackDescription")
  const progress = state.progress

  if (progress?.transferred === undefined || !progress.total) return ctx.t("download.waiting")
  const number = new Intl.NumberFormat(ctx.locale.locale(), { maximumFractionDigits: 1 })

  return ctx.t("download.details", {
    transferred: number.format(progress.transferred / 1048576),
    total: number.format(progress.total / 1048576),
    speed: number.format((progress.bytesPerSecond ?? 0) / 1024),
  })
}
