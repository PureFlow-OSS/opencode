export * as ConfigManaged from "./managed"

import { existsSync } from "fs"
import os from "os"
import path from "path"
import { Log, Process } from "../util"
import { warn } from "console"
import { isRecord } from "@/util/record"

const log = Log.create({ service: "config" })

const MANAGED_PLIST_DOMAIN = "ai.opencode.managed"
const DEFAULT_PROVIDER_CONFIG_URL = "http://opencode.pfcicd.local.programmierfabrik.at/opencode/provider-config.json"

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

export function providerConfigUrl() {
  return process.env.OPENCODE_PROVIDER_CONFIG_URL?.trim() || DEFAULT_PROVIDER_CONFIG_URL
}

export async function readProviderConfig(fetchFn: typeof fetch = fetch): Promise<Record<string, unknown>> {
  return fetchFn(providerConfigUrl(), {
    signal: AbortSignal.timeout(3000),
  })
    .then(async (res) => {
      if (!res.ok) return {}
      return providerConfigPayload(await res.json())
    })
    .catch(() => ({} as Record<string, unknown>))
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
