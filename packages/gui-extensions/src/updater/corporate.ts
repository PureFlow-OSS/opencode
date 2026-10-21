import { HttpProxy } from "@opencode/util/http-proxy"

export const API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"

const DEFAULT_BASE_URL = "http://10.53.7.23/opencode"

declare const OPENCODE_UPDATE_BASE_URL: string | undefined

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type { Fetch }

/** Only settings the server has resolved from trusted global, explicit and managed sources. */
export type CorporateSettings = {
  readonly updater?: string
  readonly aifactory_host?: string
  readonly use_http_proxy?: boolean
  readonly http_proxy?: string
}

export function corporateBaseUrl(settings: CorporateSettings) {
  return (
    settings.updater?.trim() ||
    embeddedBaseUrl() ||
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "")
}

function embeddedBaseUrl() {
  return (
    process.env.OPENCODE_UPDATE_BASE_URL?.trim() ||
    (typeof OPENCODE_UPDATE_BASE_URL === "undefined" ? undefined : OPENCODE_UPDATE_BASE_URL)?.trim()
  )
}

export function corporateUrls(settings: CorporateSettings) {
  const baseUrl = corporateBaseUrl(settings)

  return {
    baseUrl,
    version: `${baseUrl}/version`,
    feed: `${baseUrl}/url`,
    config: `${baseUrl}/config`,
  }
}

function allowedFeedUrl(url: string, baseUrl: string) {
  const base = new URL(baseUrl)
  const target = new URL(url)
  const basePath = base.pathname.replace(/\/+$/, "")

  if (target.origin === base.origin && (target.pathname === basePath || target.pathname.startsWith(`${basePath}/`)))
    return url

  if ((target.protocol !== "http:" && target.protocol !== "https:") || target.username || target.password || target.hash)
    return

  if (target.pathname !== `${basePath}/feed`) return

  if (target.search && !(target.searchParams.size === 1 && target.searchParams.get("beta"))) return

  return new URL(`${target.pathname}${target.search}`, base).toString()
}

function headers(input: HeadersInit, apiKey: string | undefined) {
  const value = new Headers(input)

  if (apiKey) value.set(API_KEY_HEADER, apiKey)

  return value
}

export async function fetchCorporateValue(url: string, options: { headers?: HeadersInit; fetchFn?: Fetch } = {}) {
  const response = await (options.fetchFn ?? HttpProxy.fetch)(url, { cache: "no-store", headers: options.headers }).catch((cause) => {
    throw new Error(`Update server request failed for ${url}: ${message(cause)}`, { cause })
  })

  if (!response.ok)
    throw new Error(`Update server request failed for ${url}: HTTP ${response.status} ${response.statusText}`)
  const value = (await response.text()).trim()

  if (!value) throw new Error(`Update server returned an empty response for ${url}`)

  return value
}

export function compareVersions(current: string, next: string) {
  const left = parseVersion(current)
  const right = parseVersion(next)

  const delta = Array.from({ length: Math.max(left.length, right.length) }, (_, index) =>
    (right[index] ?? 0) - (left[index] ?? 0),
  ).find((value) => value !== 0)

  if (!delta) return 0

  return delta > 0 ? 1 : -1
}

export function isUpdateNewer(current: string, next: string) {
  return compareVersions(current, next) > 0
}

/** Reads the corporate version and feed URL. Trusted host settings only; repository config could redirect the key. */
export async function fetchCorporateUpdate(settings: CorporateSettings, options: {
  readonly apiKey?: string
  readonly fetchFn?: Fetch
} = {}) {
  const urls = corporateUrls(settings)
  const requestHeaders = headers({}, options.apiKey?.trim() || undefined)

  const [version, url] = await Promise.all([
    fetchCorporateValue(urls.version, { headers: requestHeaders, fetchFn: options.fetchFn }),
    fetchCorporateValue(urls.feed, { headers: requestHeaders, fetchFn: options.fetchFn }),
  ])

  const feedUrl = allowedFeedUrl(url, urls.baseUrl)

  if (!feedUrl) throw new Error("Update server feed URL is not allowed")

  return { baseUrl: urls.baseUrl, version, url: feedUrl, configUrl: urls.config }
}

function parseVersion(value: string) {
  return value.trim().replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10))
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
