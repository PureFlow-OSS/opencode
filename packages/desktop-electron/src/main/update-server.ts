import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { net } from "electron"
import { updateServerBaseUrl } from "./update-server-trust"

const UPDATE_SERVER_BASE_URL = updateServerBaseUrl()

const AIFACTORY_API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"
const MOTD_TEXT_LIMIT = 180
const UPDATE_SERVER_TIMEOUT = 3_000

const parseVersion = (value: string) =>
  value
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))

export type UpdateServerMotd = {
  enabled: boolean
  text: string
}

type UpdateServerConfig = {
  version?: string
  url?: string
  motd?: UpdateServerMotd
}

type ParsedUpdateServerConfig = {
  version?: string
  url?: string
  motd?: UpdateServerMotd
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getText(value: unknown) {
  if (typeof value !== "string") return
  const text = value.trim()
  return text.length > 0 ? text : undefined
}

function parseMotd(value: unknown): UpdateServerMotd | undefined {
  if (!isRecord(value)) return
  if (value.enabled === false) return { enabled: false, text: "" }
  if (value.enabled !== true) return
  const text = getText(value.text)
  if (!text) return
  return { enabled: true, text: text.slice(0, MOTD_TEXT_LIMIT) }
}

function parseConfig(value: unknown): ParsedUpdateServerConfig | null {
  if (!isRecord(value)) return null

  const update = isRecord(value.update) ? value.update : value
  const version = getText(update.version)
  const url = getText(update.url) ?? getText(update.feedUrl)
  const motd = parseMotd(value.motd)
  if (!version && !url && !motd) return null

  return { version, url, motd }
}

function dataDir() {
  const home = os.homedir()
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "opencode")
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "opencode")
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "opencode")
}

async function aifactoryApiKey() {
  const fromEnv = process.env.OPENCODE_AIFACTORY_API_KEY?.trim()
  if (fromEnv) return fromEnv
  try {
    const payload = JSON.parse(await readFile(path.join(dataDir(), "auth.json"), "utf8")) as Record<string, unknown>
    const auth = payload["aifactory"]
    if (!isRecord(auth) || auth.type !== "api" || typeof auth.key !== "string" || !auth.key.trim()) return
    return auth.key.trim()
  } catch {
    return
  }
}

async function requestInit() {
  const apiKey = await aifactoryApiKey()
  if (!apiKey) return { cache: "no-store", signal: AbortSignal.timeout(UPDATE_SERVER_TIMEOUT) } satisfies RequestInit
  return {
    cache: "no-store",
    headers: {
      [AIFACTORY_API_KEY_HEADER]: apiKey,
    },
    signal: AbortSignal.timeout(UPDATE_SERVER_TIMEOUT),
  } satisfies RequestInit
}

export const updateServer = {
  configUrl: `${UPDATE_SERVER_BASE_URL}/config`,
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
  async fetchConfig(): Promise<ParsedUpdateServerConfig | null> {
    return net.fetch(this.configUrl, await requestInit())
      .then((result) => (result.ok ? (result.json() as Promise<unknown>) : undefined))
      .then((result) => parseConfig(result))
      .catch(() => null)
  },
  async fetchLegacy(): Promise<UpdateServerConfig | null> {
    const init = await requestInit()
    const [version, url] = await Promise.all([
      net.fetch(this.versionUrl, init)
        .then((result) => (result.ok ? result.text() : ""))
        .then((result) => result.trim())
        .catch(() => ""),
      net.fetch(this.feedUrl, init)
        .then((result) => (result.ok ? result.text() : ""))
        .then((result) => result.trim())
        .catch(() => ""),
    ])
    if (!version || !url) return null
    return { version, url }
  },
  async fetch(): Promise<UpdateServerConfig | null> {
    const config = await this.fetchConfig()
    if (config?.version && config.url) return { version: config.version, url: config.url, motd: config.motd }
    if (config?.motd) return { motd: config.motd }

    const legacy = await this.fetchLegacy()
    if (!legacy) return null
    return { ...legacy, motd: config?.motd }
  },
}
