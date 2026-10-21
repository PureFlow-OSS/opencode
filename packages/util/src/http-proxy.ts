export * as HttpProxy from "./http-proxy.js"

import type { ProxyAgent } from "undici"

const agents = new Map<string, ProxyAgent>()
const configuration: { enabled?: boolean; proxy?: string; bypass?: readonly string[] } = {}

export function configure(input: {
  use_http_proxy?: boolean
  http_proxy?: string
  aifactory_host?: string
  updater?: string
}) {
  configuration.enabled = input.use_http_proxy
  configuration.proxy = input.http_proxy
  const host = input.aifactory_host || process.env.OPENCODE_AIFACTORY_HOST || "http://10.53.7.23/v1"
  configuration.bypass = [host, input.updater || process.env.OPENCODE_UPDATE_BASE_URL || "http://10.53.7.23/opencode"]
    .filter((value) => URL.canParse(value))
    .map((value) => new URL(value).hostname)
}

export function proxyFor(input: string | URL) {
  const url = typeof input === "string" ? new URL(input) : input
  if (configuration.enabled === false) return
  const hostname = url.hostname.toLowerCase()
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    configuration.bypass?.includes(hostname)
  )
    return
  const bypass = process.env.no_proxy || process.env.NO_PROXY || ""
  if (
    bypass.split(/[,\s]+/).some((entry) => {
      if (entry === "*") return true
      const match = entry.toLowerCase().match(/^(.*?)(?::(\d+))?$/)
      if (!match?.[1]) return false
      if (match[2] && match[2] !== (url.port || (url.protocol === "https:" ? "443" : "80"))) return false
      const host = match[1].replace(/^\*/, "")
      return host.startsWith(".") ? hostname.endsWith(host) || hostname === host.slice(1) : hostname === host
    })
  )
    return
  return (
    configuration.proxy ||
    (url.protocol === "https:"
      ? process.env.https_proxy || process.env.HTTPS_PROXY
      : process.env.http_proxy || process.env.HTTP_PROXY) ||
    process.env.all_proxy ||
    process.env.ALL_PROXY
  )
}

export const fetch: typeof globalThis.fetch = Object.assign(
  async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
    const proxy = proxyFor(input instanceof Request ? input.url : input.toString())
    if (!proxy) return globalThis.fetch(input, init)
    if (typeof Bun !== "undefined") return Bun.fetch(input, { ...init, proxy })
    const { ProxyAgent } = await import("undici")
    const agent = agents.get(proxy) ?? new ProxyAgent(proxy)
    agents.set(proxy, agent)
    const options = { ...init }
    Object.defineProperty(options, "dispatcher", { value: agent, enumerable: true })
    return globalThis.fetch(input, options)
  },
  { preconnect: globalThis.fetch.preconnect },
)
