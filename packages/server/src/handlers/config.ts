import { Config } from "@opencode/core/config"
import { ShellSelect } from "@opencode/core/shell/select"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

export const ConfigHandler = HttpApiBuilder.group(Api, "server.config", (handlers) =>
  handlers
    .handle(
      "config.corporate",
      Effect.fn(function* () {
        const config = yield* Config.Service
        const settings = config.corporate ? yield* config.corporate() : {}
        return {
          updater: settings.updater,
          aifactory_host: settings.aifactory_host,
          use_http_proxy: settings.use_http_proxy,
          http_proxy: settings.http_proxy,
        }
      }),
    )
    .handle("config.get", () => Config.Service.use((config) => config.entries()))
    .handle(
      "config.update",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.update) return yield* Effect.die(new Error("Config updates are unavailable"))
        return yield* config.update(ctx.payload).pipe(Effect.orDie)
      }),
    )
    .handle(
      "config.shells",
      Effect.fn(function* () {
        const shell = yield* ShellSelect.Service
        if (!shell.list) return yield* Effect.die(new Error("Shell discovery is unavailable"))
        return yield* shell.list()
      }),
    ),
)
