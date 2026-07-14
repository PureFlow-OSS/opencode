import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const UPDATE_SERVER_BASE_URL = process.env.OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode"
const AIFACTORY_API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"
let aifactoryApiKey: string | null = null

const parseVersion = (value: string) =>
  value
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))

function dataDir() {
  const home = os.homedir()
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "opencode")
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "opencode")
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "opencode")
}

function readApiKeyFromPayload(payload: Record<string, unknown>) {
  const auth = payload.aifactory
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return null
  const value = auth as { type?: unknown; key?: unknown }
  if (value.type !== "api" || typeof value.key !== "string") return null
  const key = value.key.trim()
  return key.length > 0 ? key : null
}

async function resolveAifactoryApiKey() {
  if (aifactoryApiKey) return aifactoryApiKey
  const fromEnv = process.env.OPENCODE_AIFACTORY_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const fromContent = process.env.OPENCODE_AUTH_CONTENT
  if (fromContent) {
    try {
      const key = readApiKeyFromPayload(JSON.parse(fromContent) as Record<string, unknown>)
      if (key) return key
    } catch {}
  }
  for (const base of [dataDir(), path.join(os.homedir(), ".local", "share", "opencode"), path.join(process.env.APPDATA || "", "opencode")]) {
    if (!base) continue
    try {
      const key = readApiKeyFromPayload(JSON.parse(await readFile(path.join(base, "auth.json"), "utf8")) as Record<string, unknown>)
      if (key) return key
    } catch {}
  }
  return null
}

export const updateServer = {
  versionUrl: `${UPDATE_SERVER_BASE_URL}/version`,
  feedUrl: `${UPDATE_SERVER_BASE_URL}/url`,
  configUrl: `${UPDATE_SERVER_BASE_URL}/config`,
  setAifactoryApiKey(value: string | null) {
    aifactoryApiKey = value?.trim() || null
  },
  compareVersions(current: string, next: string) {
    const left = parseVersion(current)
    const right = parseVersion(next)
    const delta = Array.from({ length: Math.max(left.length, right.length) }, (_, index) => (right[index] ?? 0) - (left[index] ?? 0)).find((value) => value !== 0)
    if (!delta) return 0
    return delta > 0 ? 1 : -1
  },
  async fetch() {
    const apiKey = await resolveAifactoryApiKey()
    const init = {
      cache: "no-store",
      ...(apiKey ? { headers: { [AIFACTORY_API_KEY_HEADER]: apiKey } } : {}),
    } satisfies RequestInit
    const [version, url, motd] = await Promise.all([
      fetch(this.versionUrl, init)
        .then((result) => (result.ok ? result.text() : ""))
        .then((result) => result.trim())
        .catch(() => ""),
      fetch(this.feedUrl, init)
        .then((result) => (result.ok ? result.text() : ""))
        .then((result) => result.trim())
        .catch(() => ""),
      fetch(this.configUrl, init)
        .then((result) => (result.ok ? result.json() : null))
        .then((result) => {
          if (!result || typeof result !== "object") return null
          const value = "motd" in result ? (result as { motd?: unknown }).motd : null
          if (!value || typeof value !== "object") return null
          const enabled = "enabled" in value ? (value as { enabled?: unknown }).enabled : null
          const text = "text" in value ? (value as { text?: unknown }).text : null
          if (typeof enabled !== "boolean" || typeof text !== "string") return null
          return { enabled, text }
        })
        .catch(() => null),
    ])
    if (!version || !url) return null
    return { version, url, motd }
  },
  async fetchBetaStatus() {
    const apiKey = await resolveAifactoryApiKey()
    return fetch(`${UPDATE_SERVER_BASE_URL}/admin/beta/status`, {
      cache: "no-store",
      ...(apiKey ? { headers: { [AIFACTORY_API_KEY_HEADER]: apiKey } } : {}),
      signal: AbortSignal.timeout(3_000),
    })
      .then(async (response) => {
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
