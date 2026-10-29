export * as ConfigManaged from "./managed.js"

import { isRecord } from "@opencode/util/record"
import { HttpProxy } from "@opencode/util/http-proxy"
import { Option, Schema } from "effect"

declare const OPENCODE_UPDATE_BASE_URL: string | undefined

export const PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"
const cache = new Map<string, { until: number; payload: Record<string, unknown> }>()
const decode = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))

export function updateBaseUrl(config?: unknown) {
  const embedded = typeof OPENCODE_UPDATE_BASE_URL === "undefined" ? undefined : OPENCODE_UPDATE_BASE_URL
  const configured = isRecord(config) && typeof config.updater === "string" ? config.updater.trim() : undefined
  return (
    configured ||
    process.env.OPENCODE_UPDATE_BASE_URL?.trim() ||
    embedded ||
    "http://10.53.7.23/opencode"
  ).replace(/\/+$/, "")
}

export function providerConfigUrl(config?: unknown) {
  return `${updateBaseUrl(config)}/provider-config.json`
}

export function providerConfigPayload(value: unknown) {
  if (!isRecord(value)) return
  const updater = isRecord(value.Updater) ? value.Updater : isRecord(value.updater) ? value.updater : undefined
  const payload = updater && ("ProviderConfig" in updater || "providerConfig" in updater)
    ? updater.ProviderConfig ?? updater.providerConfig
    : value
  return Option.getOrUndefined(decode(payload))
}

export function aiFactoryModel(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return
  return value.trim().startsWith("aifactory/") ? value.trim() : `aifactory/${value.trim()}`
}

export function providerConfigRequestInit(input: { config?: unknown; auth?: Record<string, unknown> } = {}) {
  const auth = input.auth?.aifactory
  const config = isRecord(input.config) ? input.config : undefined
  const providers = isRecord(config?.providers)
    ? config.providers
    : isRecord(config?.provider)
      ? config.provider
      : undefined
  const provider = isRecord(providers?.aifactory) ? providers.aifactory : undefined
  const settings = isRecord(provider?.settings)
    ? provider.settings
    : isRecord(provider?.options)
      ? provider.options
      : undefined
  const key =
    isRecord(auth) && (auth.type === "key" || auth.type === "api") && typeof auth.key === "string"
      ? auth.key
      : typeof settings?.apiKey === "string"
        ? settings.apiKey
        : process.env.OPENCODE_AIFACTORY_API_KEY
  return key?.trim() ? { headers: { [PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER]: key.trim() } } : {}
}

export async function readProviderConfig(
  fetchFn: typeof fetch = HttpProxy.fetch,
  init: RequestInit = {},
  config?: unknown,
  options?: { refresh?: boolean },
): Promise<Record<string, unknown>> {
  const url = providerConfigUrl(config)
  const key = new Headers(init.headers).get(PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER) ?? ""
  const cached = cache.get(`${url}|${key}`)
  if (cached && !options?.refresh && cached.until > Date.now()) return cached.payload
  const payload = await fetchFn(url, { ...init, signal: AbortSignal.timeout(3000) })
    .then(async (response) => (response.ok ? providerConfigPayload(await response.json()) : undefined))
    .catch(() => undefined)
  if (payload === undefined) return cached?.payload ?? {}
  cache.set(`${url}|${key}`, { until: Date.now() + 300_000, payload })
  return payload
}
import { Config } from "@opencode/schema/config"

/** A document from managed configuration: the system config directory or MDM managed preferences. */
export class Document extends Config.Document.extend<Document>("Config.ManagedDocument")({}) {}
