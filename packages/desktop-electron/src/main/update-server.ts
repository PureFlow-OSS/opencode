import { net } from "electron"
import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { updateServerBaseUrl } from "./update-server-trust"

const baseUrl = updateServerBaseUrl()
const API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"

function readApiKeyFromPayload(payload: Record<string, unknown>) {
  const auth = payload.aifactory
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return null
  const value = auth as { type?: unknown; key?: unknown }
  if (value.type !== "api" || typeof value.key !== "string") return null
  const key = value.key.trim()
  return key.length > 0 ? key : null
}

async function resolveAifactoryApiKey() {
  const fromEnv = process.env.OPENCODE_AIFACTORY_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const fromContent = process.env.OPENCODE_AUTH_CONTENT
  if (fromContent) {
    try {
      const key = readApiKeyFromPayload(JSON.parse(fromContent) as Record<string, unknown>)
      if (key) return key
    } catch {}
  }
  const home = os.homedir()
  const directories = [
    path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "opencode"),
    path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "opencode"),
    path.join(home, ".local", "share", "opencode"),
  ]
  for (const directory of directories) {
    try {
      const key = readApiKeyFromPayload(JSON.parse(await readFile(path.join(directory, "auth.json"), "utf8")) as Record<string, unknown>)
      if (key) return key
    } catch {}
  }
  return null
}

async function requestInit() {
  const apiKey = await resolveAifactoryApiKey()
  return {
    cache: "no-store",
    ...(apiKey ? { headers: { [API_KEY_HEADER]: apiKey } } : {}),
    signal: AbortSignal.timeout(3000),
  } satisfies RequestInit
}

function versionParts(value: string) {
  return value.trim().replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0)
}

type BetaStatus = {
  betaTester: boolean
  betaUserName: string | null
}

type UpdateMotd = { enabled: boolean; text: string }

export const updateServer = {
  configUrl: `${baseUrl}/config`,
  versionUrl: `${baseUrl}/version`,
  feedUrl: `${baseUrl}/url`,
  betaStatusUrl: `${baseUrl}/admin/beta/status`,
  compareVersions(current: string, next: string) {
    const left = versionParts(current)
    const right = versionParts(next)
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const difference = (right[index] ?? 0) - (left[index] ?? 0)
      if (difference) return difference > 0 ? 1 : -1
    }
    return 0
  },
  async fetch() {
    const init = await requestInit()
    const [version, url, motd] = await Promise.all([
      net.fetch(`${baseUrl}/version`, init).then((response) => (response.ok ? response.text() : "")).catch(() => ""),
      net.fetch(`${baseUrl}/url`, init).then((response) => (response.ok ? response.text() : "")).catch(() => ""),
      net
        .fetch(`${baseUrl}/config`, init)
        .then(async (response) => {
          if (!response.ok) return undefined
          const value = (await response.json()) as Record<string, unknown>
          const item = value.motd
          if (!item || typeof item !== "object" || Array.isArray(item)) return undefined
          const config = item as Record<string, unknown>
          if (typeof config.text !== "string") return undefined
          return { enabled: config.enabled !== false, text: config.text } satisfies UpdateMotd
        })
        .catch(() => undefined),
    ])
    if (!version.trim() || !url.trim()) return null
    return { version: version.trim(), url: url.trim(), motd }
  },
  async fetchBetaStatus() {
    return net
      .fetch(`${baseUrl}/admin/beta/status`, await requestInit())
      .then(async (response): Promise<BetaStatus | null> => {
        if (!response.ok) return null
        const value = (await response.json()) as Record<string, unknown>
        return {
          betaTester: value.betaTester === true,
          betaUserName: typeof value.betaUserName === "string" ? value.betaUserName : null,
        }
      })
      .catch(() => null)
  },
}
