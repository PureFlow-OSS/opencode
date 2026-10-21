export * as ConfigManagedMcp from "./managed-mcp.js"

import { Mcp } from "@opencode/schema/mcp"
import { HttpProxy } from "@opencode/util/http-proxy"
import { Effect, Option, Schema } from "effect"
import { Integration } from "@opencode/schema/integration"
import { Config } from "../config.js"
import { Credential } from "../credential.js"
import { ConfigManaged } from "./managed.js"
import { ConfigMCPV1 } from "../v1/config/mcp.js"
import { ConfigMigrateV1 } from "../v1/config/migrate.js"

const decodeServer = Schema.decodeUnknownOption(Mcp.ServerConfig)
const decodeLegacyServer = Schema.decodeUnknownOption(ConfigMCPV1.Info)
const decodeAuth = Schema.decodeUnknownOption(Mcp.PatAuth)
const decodeStoreItem = Schema.decodeUnknownOption(Mcp.StoreItem)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isLegacy = (value: Record<string, unknown>) => {
  const oauth = value.oauth
  return (
    "enabled" in value ||
    typeof value.timeout === "number" ||
    (isRecord(oauth) && ["clientId", "clientSecret", "callbackPort", "redirectUri"].some((key) => key in oauth))
  )
}

const clean = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (item === undefined) return []
      if (isRecord(item)) return [[key, clean(item)]]
      return [[key, item]]
    }),
  )

export function managed(payload: Record<string, unknown>): Record<string, Mcp.ManagedServer> {
  if (!isRecord(payload.mcp)) return {}
  return Object.fromEntries(
    Object.entries(payload.mcp).flatMap(([name, value]) => {
      if (!isRecord(value)) return []
      const legacy = isLegacy(value) ? Option.getOrUndefined(decodeLegacyServer(value)) : undefined
      const migrated = legacy ? (ConfigMigrateV1.migrateMcp(legacy) as Record<string, unknown>) : value
      const config = Option.getOrUndefined(decodeServer(clean(migrated)))
      if (!config) return []
      const auth = Option.getOrUndefined(decodeAuth(value.auth))
      return [[name, { config, auth, locked: value.locked !== false, provenance: "provider-config" }]]
    }),
  )
}

export function store(value: unknown): Mcp.StoreItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const headers = item.lockedHeaderNames ?? item.headerNames
    return Option.toArray(decodeStoreItem({ ...item, lockedHeaderNames: headers }))
  })
}

export function storeUrl(config?: unknown) {
  return `${ConfigManaged.updateBaseUrl(config)}/mcp-store.json`
}

export async function readStore(
  fetchFn: typeof fetch = HttpProxy.fetch,
  init: RequestInit = {},
  config?: unknown,
): Promise<Mcp.StoreItem[]> {
  const response = await fetchFn(storeUrl(config), { ...init, signal: AbortSignal.timeout(3000) })
    .then(async (response) => (response.ok ? await response.json() : []))
    .catch(() => [])
  return store(response)
}

export function catalog(input: { payload: Record<string, unknown>; store: unknown }): Mcp.ManagedCatalog {
  return { managed: managed(input.payload), store: store(input.store) }
}

export const catalogEffect = Effect.fn("ConfigManagedMcp.catalog")(function* () {
  const config = yield* Config.Service
  const credentials = yield* Credential.Service
  const settings = yield* (config.corporate
    ? config.corporate()
    : config.entries().pipe(Effect.map(Config.corporateSettings)))
  const credential = (yield* credentials.list(Integration.ID.make("aifactory"))).at(-1)?.value
  const init = ConfigManaged.providerConfigRequestInit({
    config: settings,
    auth: credential ? { aifactory: credential } : undefined,
  })
  const payload = yield* Effect.promise(() => ConfigManaged.readProviderConfig(undefined, init, settings))
  const storePayload = yield* Effect.promise(() => readStore(undefined, init, settings))
  return catalog({ payload, store: storePayload })
})
