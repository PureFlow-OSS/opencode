import { Schema } from "effect"
import { Ipc } from "./core.js"

/** Current transfer or preparation phase; byte counts describe the actual network transfer. */
export const UpdaterProgress = Schema.Struct({
  phase: Schema.Literals(["download", "verify", "unpack"]),
  percent: Schema.optional(Schema.Number),
  transferred: Schema.optional(Schema.Number),
  total: Schema.optional(Schema.Number),
  bytesPerSecond: Schema.optional(Schema.Number),
})

/** Transfer metrics and preparation phase; see `UpdaterProgress`. */
export type UpdaterProgress = typeof UpdaterProgress.Type

/**
 * The updater's state, the same in every window.
 * - `disabled`: this build does not update itself.
 * - `idle`: no check has run yet.
 * - `checking`: a check is running.
 * - `downloading`: `version` is downloading.
 * - `ready`: `version` is staged; `install` restarts into it.
 * - `download-required`: `version` needs a manual download; `install` opens it.
 * - `up-to-date`: the last check found nothing newer.
 * - `installing`: `version` is installing.
 * - `error`: the last check or download failed with `message`.
 */
export const UpdaterState = Schema.Union([
  Schema.Struct({ status: Schema.Literal("disabled") }),
  Schema.Struct({ status: Schema.Literal("idle") }),
  Schema.Struct({ status: Schema.Literal("checking") }),
  Schema.Struct({
    status: Schema.Literal("downloading"),
    version: Schema.String,
    progress: Schema.optional(UpdaterProgress),
  }),
  Schema.Struct({ status: Schema.Literal("ready"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("download-required"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("up-to-date") }),
  Schema.Struct({ status: Schema.Literal("installing"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("error"), message: Schema.String }),
])

/** The updater's state; see `UpdaterState`. */
export type UpdaterState = typeof UpdaterState.Type

/** The desktop app updater. Its state is app-wide; every window receives the same value. */
export const Updater = Ipc.define({
  id: "updater",
  state: UpdaterState,
  methods: {
    check: { output: UpdaterState },
    changelog: { output: Schema.Struct({ content: Schema.String }) },
    /** Restarts into a staged update, or opens the installer download. */
    install: {},
  },
  events: {
    /** The app menu asks the focused window to check with in-app feedback (beta builds). */
    check: Schema.Null,
  },
})
