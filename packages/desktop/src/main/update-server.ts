const UPDATE_SERVER_BASE_URL = process.env.OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode"

const parseVersion = (value: string) =>
  value
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))

export const updateServer = {
  versionUrl: `${UPDATE_SERVER_BASE_URL}/version`,
  feedUrl: `${UPDATE_SERVER_BASE_URL}/url`,
  configUrl: `${UPDATE_SERVER_BASE_URL}/config`,
  compareVersions(current: string, next: string) {
    const left = parseVersion(current)
    const right = parseVersion(next)
    const delta = Array.from({ length: Math.max(left.length, right.length) }, (_, index) => (right[index] ?? 0) - (left[index] ?? 0)).find((value) => value !== 0)
    if (!delta) return 0
    return delta > 0 ? 1 : -1
  },
  async fetch() {
    const [version, url, motd] = await Promise.all([
      fetch(this.versionUrl, { cache: "no-store" })
        .then((result) => (result.ok ? result.text() : ""))
        .then((result) => result.trim())
        .catch(() => ""),
      fetch(this.feedUrl, { cache: "no-store" })
        .then((result) => (result.ok ? result.text() : ""))
        .then((result) => result.trim())
        .catch(() => ""),
      fetch(this.configUrl, { cache: "no-store" })
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
}
