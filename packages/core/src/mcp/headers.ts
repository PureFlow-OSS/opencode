export * as McpHeaders from "./headers.js"

import { Effect } from "effect"
import { Mcp } from "@opencode/schema/mcp"
import { Config } from "../config.js"
import { ConfigManaged } from "../config/managed.js"
import { Integration } from "../integration.js"

export const AIFACTORY_API_KEY_HEADER = "x-litellm-api-key"

export function hasAiFactoryHeader(headers?: Record<string, string>) {
  return Object.keys(headers ?? {}).some((name) => name.toLowerCase() === AIFACTORY_API_KEY_HEADER)
}

export function withAiFactoryHeader(headers: Record<string, string> | undefined, apiKey: string | undefined) {
  const name = Object.keys(headers ?? {}).find((name) => name.toLowerCase() === AIFACTORY_API_KEY_HEADER)
  if (!name || headers?.[name]?.trim()) return headers
  return apiKey?.trim() ? { ...headers, [name]: apiKey.trim() } : headers
}

export function makeResolver(config: Config.Interface, integration: Integration.Interface) {
  return Effect.fnUntraced(function* (serverConfig: Mcp.ServerConfig) {
    if (serverConfig.type !== "remote" || !hasAiFactoryHeader(serverConfig.headers)) return serverConfig
    const settings = yield* (config.corporate ? config.corporate() : config.entries().pipe(Effect.map(Config.corporateSettings)))
    const active = yield* integration.connection
      .active(Integration.ID.make("aifactory"))
      .pipe(Effect.orElseSucceed(() => undefined))
    const credential = active
      ? yield* integration.connection.resolve(active).pipe(Effect.orElseSucceed(() => undefined))
      : undefined
    const init = ConfigManaged.providerConfigRequestInit({
      config: settings,
      auth: credential?.type === "key" ? { aifactory: credential } : undefined,
    })
    const apiKey = new Headers(init.headers).get(ConfigManaged.PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER)
    return { ...serverConfig, headers: withAiFactoryHeader(serverConfig.headers, apiKey ?? undefined) }
  })
}
