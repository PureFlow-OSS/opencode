export * as ConfigManaged from "./managed"

import { existsSync } from "fs"
import os from "os"
import path from "path"
import { Log, Process } from "../util"
import { warn } from "console"
import { isRecord } from "@/util/record"

declare const OPENCODE_UPDATE_BASE_URL: string | undefined

const log = Log.create({ service: "config" })

const MANAGED_PLIST_DOMAIN = "ai.opencode.managed"
const DEFAULT_UPDATE_BASE_URL = "http://opencode.pfcicd.local.programmierfabrik.at/opencode"
export const PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"

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

export function updateBaseUrl(config?: unknown) {
  const embedded = typeof OPENCODE_UPDATE_BASE_URL !== "undefined" ? OPENCODE_UPDATE_BASE_URL : undefined
  const override = isRecord(config) && typeof config.updater === "string" ? config.updater.trim() : undefined
  return (override || process.env.OPENCODE_UPDATE_BASE_URL?.trim() || embedded || DEFAULT_UPDATE_BASE_URL).replace(
    /\/+$/,
    "",
  )
}

export function providerConfigUrl(config?: unknown) {
  return `${updateBaseUrl(config)}/provider-config.json`
}

function isRecordWith<T extends string>(value: unknown, key: T): value is Record<T, unknown> {
  return isRecord(value) && key in value
}

export function aifactoryApiKey(input: { config?: unknown; auth?: Record<string, unknown> }) {
  const auth = input.auth?.["aifactory"]
  if (isRecord(auth) && auth.type === "api" && typeof auth.key === "string" && auth.key.trim()) {
    return auth.key.trim()
  }
  const provider = isRecord(input.config) && isRecord(input.config.provider) ? input.config.provider : undefined
  const aifactory = provider && isRecord(provider.aifactory) ? provider.aifactory : undefined
  const options = aifactory && isRecord(aifactory.options) ? aifactory.options : undefined
  if (typeof options?.apiKey !== "string" || !options.apiKey.trim()) return
  return options.apiKey.trim()
}

export function providerConfigRequestInit(
  input: {
    config?: unknown
    auth?: Record<string, unknown>
  } = {},
) {
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
  config?: unknown,
): Promise<Record<string, unknown>> {
  return fetchFn(providerConfigUrl(config), {
    ...init,
    signal: AbortSignal.timeout(3000),
  })
    .then(async (res) => {
      if (!res.ok) return {}
      return providerConfigPayload(await res.json())
    })
    .catch(() => ({}) as Record<string, unknown>)
}

export async function readManagedPreferences() {
  if (process.platform !== "darwin") return

  const user = os.userInfo().username
  const paths = [
    path.join("/Library/Managed Preferences", user, `${MANAGED_PLIST_DOMAIN}.plist`),
    path.join("/Library/Managed Preferences", `${MANAGED_PLIST_DOMAIN}.plist`),
  ]

  for (const plist of paths) {
    if (!existsSync(plist)) continue
    log.info("reading macOS managed preferences", { path: plist })
    const result = await Process.run(["plutil", "-convert", "json", "-o", "-", plist], { nothrow: true })
    if (result.code !== 0) {
      log.warn("failed to convert managed preferences plist", { path: plist })
      continue
    }
    return {
      source: `mobileconfig:${plist}`,
      text: parseManagedPlist(result.stdout.toString()),
    }
  }

  return
}
