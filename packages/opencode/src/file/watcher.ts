import { Cause, Effect, Layer, Context, Schema } from "effect"
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import type ParcelWatcher from "@parcel/watcher"
import { readdir } from "fs/promises"
import path from "path"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Git } from "@/git"
import { lazy } from "@/util/lazy"
import { Config } from "../config"
import { FileIgnore } from "./ignore"
import { Protected } from "./protected"
import { Log } from "../util"

declare const OPENCODE_LIBC: string | undefined

const log = Log.create({ service: "file.watcher" })
const SUBSCRIBE_TIMEOUT_MS = 10_000

export const Event = {
  Updated: BusEvent.define(
    "file.watcher.updated",
    Schema.Struct({
      file: Schema.String,
      event: Schema.Literals(["add", "change", "unlink"]),
    }),
  ),
}

const watcher = lazy((): typeof import("@parcel/watcher") | undefined => {
  try {
    const binding = require(
      `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${OPENCODE_LIBC || "glibc"}` : ""}`,
    )
    return createWrapper(binding) as typeof import("@parcel/watcher")
  } catch (error) {
    log.warn("failed to load watcher binding, falling back to chokidar", { error })
    return
  }
})

function getBackend() {
  if (process.platform === "win32") return "windows"
  if (process.platform === "darwin") return "fs-events"
  if (process.platform === "linux") return "inotify"
}

function protecteds(dir: string) {
  return Protected.paths().filter((item) => {
    const rel = path.relative(dir, item)
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
  })
}

export const hasNativeBinding = () => !!watcher()

function ignored(dir: string, ignore: string[], filepath: string) {
  const rel = path.relative(dir, filepath)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false
  return FileIgnore.match(rel, {
    extra: ignore.map((item) => (path.isAbsolute(item) ? path.relative(dir, item) : item)),
  })
}

async function startSubscription(
  dir: string,
  ignore: string[],
  backend: NonNullable<ReturnType<typeof getBackend>>,
  cb: ParcelWatcher.SubscribeCallback,
) {
  const native = watcher()
  if (native) {
    try {
      return await native.subscribe(dir, cb, { ignore, backend })
    } catch (error) {
      log.warn("native watcher subscribe failed, falling back to chokidar", { dir, error })
    }
  }

  const { default: chokidar } = await import("chokidar")
  const instance = chokidar.watch(dir, {
    ignoreInitial: true,
    ignored: (filepath) => ignored(dir, ignore, filepath),
  })
  const publish = (event: "create" | "update" | "delete") => (filepath: string) => cb(null, [{ path: filepath, type: event }])
  instance.on("add", publish("create"))
  instance.on("change", publish("update"))
  instance.on("unlink", publish("delete"))
  return {
    unsubscribe: () => instance.close(),
  } satisfies Pick<ParcelWatcher.AsyncSubscription, "unsubscribe">
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileWatcher") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const git = yield* Git.Service

    const state = yield* InstanceState.make((ctx) =>
      Effect.fn("FileWatcher.state")(
        function* () {
          if (yield* Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER) return

          log.info("init", { directory: ctx.directory })

          const backend = getBackend()
          if (!backend) {
            log.error("watcher backend not supported", { directory: ctx.directory, platform: process.platform })
            return
          }

          log.info("watcher backend", {
            directory: ctx.directory,
            platform: process.platform,
            backend,
            native: hasNativeBinding(),
          })

          const subs: Pick<ParcelWatcher.AsyncSubscription, "unsubscribe">[] = []
          yield* Effect.addFinalizer(() =>
            Effect.promise(() => Promise.allSettled(subs.map((sub) => sub.unsubscribe()))),
          )

          const cb: ParcelWatcher.SubscribeCallback = InstanceState.bind((err, evts) => {
            if (err) return
            for (const evt of evts) {
              if (evt.type === "create") void Bus.publish(Event.Updated, { file: evt.path, event: "add" })
              if (evt.type === "update") void Bus.publish(Event.Updated, { file: evt.path, event: "change" })
              if (evt.type === "delete") void Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
            }
          })

          const subscribe = (dir: string, ignore: string[]) => {
            const pending = startSubscription(dir, ignore, backend, cb)
            return Effect.gen(function* () {
              const sub = yield* Effect.promise(() => pending)
              subs.push(sub)
            }).pipe(
              Effect.timeout(SUBSCRIBE_TIMEOUT_MS),
              Effect.catchCause((cause) => {
                log.error("failed to subscribe", { dir, cause: Cause.pretty(cause) })
                pending.then((s) => s.unsubscribe()).catch(() => {})
                return Effect.void
              }),
            )
          }

          const cfg = yield* config.get()
          const cfgIgnores = cfg.watcher?.ignore ?? []

          if (yield* Flag.OPENCODE_EXPERIMENTAL_FILEWATCHER) {
            yield* subscribe(ctx.directory, [
              ...FileIgnore.PATTERNS,
              ...cfgIgnores,
              ...protecteds(ctx.directory),
            ])
          }

          if (ctx.project.vcs === "git") {
            const result = yield* git.run(["rev-parse", "--git-dir"], {
              cwd: ctx.project.worktree,
            })
            const vcsDir =
              result.exitCode === 0 ? path.resolve(ctx.project.worktree, result.text().trim()) : undefined
            if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
              const ignore = (yield* Effect.promise(() => readdir(vcsDir).catch(() => []))).filter(
                (entry) => entry !== "HEAD",
              )
              yield* subscribe(vcsDir, ignore)
            }
          }
        },
        Effect.catchCause((cause) => {
          log.error("failed to init watcher service", { cause: Cause.pretty(cause) })
          return Effect.void
        }),
      )(),
    )

    return Service.of({
      init: Effect.fn("FileWatcher.init")(function* () {
        yield* InstanceState.get(state)
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(Git.defaultLayer))

export * as FileWatcher from "./watcher"
