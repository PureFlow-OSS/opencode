import { net } from "electron"
import { updateServerBaseUrl } from "./update-server-trust"

const baseUrl = updateServerBaseUrl()
const API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"

function requestInit() {
  const apiKey = process.env.OPENCODE_AIFACTORY_API_KEY?.trim()
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
    const init = requestInit()
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
      .fetch(`${baseUrl}/admin/beta/status`, requestInit())
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
