const UPDATE_SERVER_BASE_URL = import.meta.env.VITE_OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode"

const parseVersion = (value: string) =>
  value
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))

export const updateServer = {
  manifestUrl: `${UPDATE_SERVER_BASE_URL}/latest.json`,
  versionUrl: `${UPDATE_SERVER_BASE_URL}/version`,
  feedUrl: `${UPDATE_SERVER_BASE_URL}/url`,
  compareVersions(current: string, next: string) {
    const left = parseVersion(current)
    const right = parseVersion(next)
    const delta = Array.from(
      { length: Math.max(left.length, right.length) },
      (_, index) => (right[index] ?? 0) - (left[index] ?? 0),
    ).find((value) => value !== 0)
    if (!delta) return 0
    return delta > 0 ? 1 : -1
  },
  async fetch() {
    const [version, url] = await Promise.all([
      fetch(this.versionUrl, { cache: "no-store" })
        .then((result) => (result.ok ? result.text() : ""))
        .then((result) => result.trim())
        .catch(() => ""),
      fetch(this.feedUrl, { cache: "no-store" })
        .then((result) => (result.ok ? result.text() : ""))
        .then((result) => result.trim())
        .catch(() => ""),
    ])
    if (!version || !url) return null
    return { version, url }
  },
}
