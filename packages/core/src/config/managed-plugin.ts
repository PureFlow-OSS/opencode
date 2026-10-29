export * as ConfigManagedPlugin from "./managed-plugin.js"

import { Plugin } from "@opencode/schema/plugin"
import { Integration } from "@opencode/schema/integration"
import { HttpProxy } from "@opencode/util/http-proxy"
import { Effect, Schema } from "effect"
import { Config } from "../config.js"
import { Credential } from "../credential.js"
import { ConfigManaged } from "./managed.js"

export async function readStore(fetchFn: typeof fetch = HttpProxy.fetch, init: RequestInit = {}, config?: unknown) {
  const response = await fetchFn(`${ConfigManaged.updateBaseUrl(config)}/plugin-store.json`, {
    ...init,
    signal: AbortSignal.timeout(3000),
  })
  if (!response.ok) throw new Error("Plugin catalog request failed")
  return Schema.decodeUnknownSync(Schema.Array(Plugin.StoreItem))(await response.json())
}

export const catalogEffect = Effect.fn("ConfigManagedPlugin.catalog")(function* () {
  const config = yield* Config.Service
  const credentials = yield* Credential.Service
  const settings = yield* config.corporate
    ? config.corporate()
    : config.entries().pipe(Effect.map(Config.corporateSettings))
  const credential = (yield* credentials.list(Integration.ID.make("aifactory"))).at(-1)?.value
  const init = ConfigManaged.providerConfigRequestInit({
    config: settings,
    auth: credential ? { aifactory: credential } : undefined,
  })
  const result = yield* Effect.all({
    catalog: Effect.tryPromise(() => readStore(undefined, init, settings)).pipe(
      Effect.map((store) => ({ store, available: true })),
      Effect.catch(() => Effect.succeed({ store: [], available: false })),
    ),
    packages: config.globalPlugins ? config.globalPlugins() : Effect.succeed([]),
  })
  return { ...result.catalog, packages: result.packages }
})
