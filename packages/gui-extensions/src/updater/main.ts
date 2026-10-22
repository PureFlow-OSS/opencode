import { dialog } from "electron"
import { Effect, Exit, Scope } from "effect"
import { MenubarItem, type MainSetup } from "../sdk/main"
import { Updater } from "./contract"
import type definition from "./index"
import { logContext } from "./log"
import { make } from "./machine"

const setup: MainSetup<typeof definition> = async (ctx) => {
  const build = ctx.build
  const lifecycle = ctx.lifecycle
  const enabled = build.packaged && build.channel !== "dev"
  // Holds no resources, so it needs no cleanup.
  const context = logContext(ctx.log.write)
  const runPromise = Effect.runPromiseWith(context)
  const runFork = Effect.runForkWith(context)
  const ready = ctx.stores.ready

  // electron-updater loads only in packaged builds that update, after the first window is up.
  const platform = enabled
    ? await import("./platform").then((module) =>
        runPromise(
          module.make({
            channel: build.channel,
            currentVersion: build.version,
            corporateSettings: () => corporateSettings(ctx),
            apiKey: () => apiKey(ctx),
          }),
        ),
      )
    : undefined

  if (ctx.scope.signal.aborted) return
  const scope = Scope.makeUnsafe()
  ctx.scope.addFinalizer(() => runPromise(Scope.close(scope, Exit.void)))
  const publish = { changed: () => {} }

  const updater = await runPromise(
    make({
      currentVersion: build.version,
      platform,
      // The updater stays active through the handoff, so a failed install returns to a state the user can retry.
      restart: (handoff) =>
        Effect.tryPromise({
          try: () => lifecycle.restart(() => runPromise(handoff), { keep: ctx.scope }),
          catch: (error) => error,
        }),
      persistence: {
        get: Effect.sync(() => ready.value ?? undefined),
        set: (value) => Effect.sync(() => ready.set(value)),
        clear: Effect.sync(() => ready.set(null)),
      },
      changed: () => publish.changed(),
    }).pipe(Scope.provide(scope)),
  )

  const provider = ctx.provide(Updater, {
    state: () => updater.state(),
    check: () => runPromise(updater.check),
    changelog: async () => {
      const { fetchCorporateChangelog } = await import("./corporate")
      const settings = await corporateSettings(ctx)

      return { content: await fetchCorporateChangelog(settings, { apiKey: await apiKey(ctx) }) }
    },
    install: () => runPromise(updater.install),
  })

  publish.changed = () => provider.changed()

  const show = Effect.gen(function* () {
    const state = yield* updater.check

    if (state.status === "error") {
      yield* promise(() =>
        dialog.showMessageBox({
          type: "error",
          message: ctx.t("dialog.checkFailed.message"),
          title: ctx.t("dialog.checkFailed.title"),
        }),
      )

      return
    }

    if (state.status === "up-to-date") {
      yield* promise(() =>
        dialog.showMessageBox({
          type: "info",
          message: ctx.t("dialog.upToDate.message"),
          title: ctx.t("dialog.upToDate.title"),
        }),
      )

      return
    }

    if (state.status !== "ready") return

    const response = yield* promise(() =>
      dialog.showMessageBox({
        type: "info",
        message: ctx.t("dialog.ready.message", { version: state.version }),
        title: ctx.t("dialog.ready.title"),
        buttons: [ctx.t("dialog.restart"), ctx.t("dialog.later")],
        defaultId: 0,
        cancelId: 1,
      }),
    )

    if (response.response === 0) yield* updater.install
  })

  ctx.add(
    MenubarItem,
    (): MenubarItem => ({
      menu: "app",
      id: "check",
      label: ctx.t("menu.check"),
      after: "about",
      enabled: () => enabled,
      run(window) {
        // Beta builds check in the focused window, which reports the result in-app.
        if (build.channel !== "beta") return void runFork(show)

        if (window) provider.emit("check", null, window.id)
      },
    }),
  )
}

function promise<A>(evaluate: () => Promise<A>) {
  return Effect.tryPromise(evaluate).pipe(Effect.orDie)
}

async function corporateSettings(ctx: Parameters<MainSetup<typeof definition>>[0]) {
  const client = await sidecarClient(ctx)

  return client.config.corporate()
}

async function apiKey(ctx: Parameters<MainSetup<typeof definition>>[0]) {
  const client = await sidecarClient(ctx)
  const credentials = await client.credential.list()
  const key = credentials.find((entry) => entry.integrationID === "aifactory" && entry.active)

  if (key?.value.type === "key") {
    const value = key.value.key.trim()

    if (value) return value
  }

  return process.env.OPENCODE_AIFACTORY_API_KEY?.trim()
}

/**
 * Reads the current sidecar each call so a restarted server cannot be reached through a stale URL or password.
 * The basic authorization header stays on these two API requests and is never passed to the corporate update server.
 */
async function sidecarClient(ctx: Parameters<MainSetup<typeof definition>>[0]) {
  const server = ctx.serverEndpoints.get("sidecar")

  if (!server) throw new Error("Sidecar server is unavailable")

  const { OpenCode } = await import("@opencode/client/promise")

  return OpenCode.make({
    baseUrl: server.url,
    headers: Object.keys(server.headers).length ? server.headers : undefined,
  })
}

export default setup
