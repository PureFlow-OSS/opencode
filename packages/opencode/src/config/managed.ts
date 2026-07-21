export * as ConfigManaged from "./managed"

import { existsSync } from "fs"
import os from "os"
import path from "path"
import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import { Process } from "@/util/process"
import { isRecord } from "@/util/record"
import { Option, Schema } from "effect"

declare const OPENCODE_UPDATE_BASE_URL: string | undefined

const DEFAULT_UPDATE_BASE_URL = "http://10.53.7.23/opencode"
export const PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"

export const McpAuth = Schema.Struct({
  type: Schema.Literal("pat"),
  label: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  placeholder: Schema.optional(Schema.String),
  header: Schema.optional(Schema.String),
  prefix: Schema.optional(Schema.String),
})
export type McpAuth = Schema.Schema.Type<typeof McpAuth>

export const Mcp = Schema.Struct({
  config: ConfigMCPV1.Info,
  auth: Schema.optional(McpAuth),
})
export type Mcp = Schema.Schema.Type<typeof Mcp>

const decodeMcp = Schema.decodeUnknownOption(ConfigMCPV1.Info, { onExcessProperty: "ignore" })
const decodeMcpAuth = Schema.decodeUnknownOption(McpAuth, { onExcessProperty: "ignore" })

const MANAGED_PLIST_DOMAIN = "ai.opencode.managed"

// Keys injected by macOS/MDM into the managed plist that are not OpenCode config
const PLIST_META = new Set([
  "PayloadDisplayName",
  "PayloadIdentifier",
  "PayloadType",
  "PayloadUUID",
  "PayloadVersion",
  "_manualProfile",
])

function systemManagedConfigDir(): string {
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/opencode"
    case "win32":
      return path.join(process.env.ProgramData || "C:\\ProgramData", "opencode")
    default:
      return "/etc/opencode"
  }
}

export function managedConfigDir() {
  return process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR || systemManagedConfigDir()
}

export function parseManagedPlist(json: string): string {
  const raw = JSON.parse(json)
  for (const key of Object.keys(raw)) {
    if (PLIST_META.has(key)) delete raw[key]
  }
  return JSON.stringify(raw)
}

export function providerConfigPayload(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {}
  const updater = isRecord(payload.Updater) ? payload.Updater : isRecord(payload.updater) ? payload.updater : undefined
  if (!updater) return payload
  return isRecord(updater.ProviderConfig)
    ? updater.ProviderConfig
    : isRecord(updater.providerConfig)
      ? updater.providerConfig
      : payload
}

export function aiFactoryModel(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return
  return value.startsWith("aifactory/") ? value : `aifactory/${value.trim()}`
}

export function mcp(payload: Record<string, unknown>): Record<string, Mcp> {
  if (!isRecord(payload.mcp)) return {}
  return Object.fromEntries(
    Object.entries(payload.mcp).flatMap(([name, value]) => {
      if (!isRecord(value)) return []
      const configInput = { ...value }
      delete configInput.auth
      const config = Option.getOrUndefined(decodeMcp(configInput))
      if (!config) return []
      const auth = Option.getOrUndefined(decodeMcpAuth(value.auth))
      return [[name, auth ? { config, auth } : { config }]]
    }),
  )
}

export function updateBaseUrl() {
  const embedded = typeof OPENCODE_UPDATE_BASE_URL !== "undefined" ? OPENCODE_UPDATE_BASE_URL : undefined
  return (process.env.OPENCODE_UPDATE_BASE_URL?.trim() || embedded || DEFAULT_UPDATE_BASE_URL).replace(/\/+$/, "")
}

export function providerConfigUrl() {
  return `${updateBaseUrl()}/provider-config.json`
}

function aifactoryApiKey(input: { config?: unknown; auth?: Record<string, unknown> }) {
  const auth = input.auth?.aifactory
  if (isRecord(auth) && auth.type === "api" && typeof auth.key === "string" && auth.key.trim()) return auth.key.trim()
  const config = isRecord(input.config) && isRecord(input.config.provider) ? input.config.provider : undefined
  const provider = config && isRecord(config.aifactory) ? config.aifactory : undefined
  const options = provider && isRecord(provider.options) ? provider.options : undefined
  if (typeof options?.apiKey !== "string" || !options.apiKey.trim()) return
  return options.apiKey.trim()
}

export function providerConfigRequestInit(input: { config?: unknown; auth?: Record<string, unknown> } = {}) {
  const apiKey = aifactoryApiKey(input) ?? process.env.OPENCODE_AIFACTORY_API_KEY?.trim()
  if (!apiKey) return {}
  return {
    headers: {
      [PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER]: apiKey,
    },
  } satisfies RequestInit
}

export async function readProviderConfig(
  fetchFn: typeof fetch = fetch,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  return fetchFn(providerConfigUrl(), {
    ...init,
    signal: AbortSignal.timeout(3000),
  })
    .then(async (response) => {
      if (!response.ok) return {}
      const payload = providerConfigPayload(await response.json())
      return isRecord(payload) ? payload : {}
    })
    .catch(() => ({}))
}

export async function readManagedPreferences() {
  if (process.platform !== "darwin") return

  const user = (() => {
    try {
      return os.userInfo().username || "user"
    } catch {
      return "user"
    }
  })()
  const paths = [
    path.join("/Library/Managed Preferences", user, `${MANAGED_PLIST_DOMAIN}.plist`),
    path.join("/Library/Managed Preferences", `${MANAGED_PLIST_DOMAIN}.plist`),
  ]

  for (const plist of paths) {
    if (!existsSync(plist)) continue
    const result = await Process.run(["plutil", "-convert", "json", "-o", "-", plist], { nothrow: true })
    if (result.code !== 0) continue
    return {
      source: `mobileconfig:${plist}`,
      text: parseManagedPlist(result.stdout.toString()),
    }
  }

  return
}
