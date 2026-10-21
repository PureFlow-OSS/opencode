export * as HttpProxy from "./http-proxy.js"

import type { Agent, ProxyAgent } from "undici"

const agents = new Map<string, ProxyAgent>()
const direct: { agent?: Agent } = {}
const configuration: { enabled?: boolean; proxy?: string; bypass?: readonly string[] } = {}
const proxyVariables = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]

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

/** Explicit child-process environment overrides; the host environment is never mutated. */
export function environment(): Record<string, string | undefined> {
  if (configuration.enabled === undefined) return {}
  const bypass = [
    ...new Set(
      [
        ...(process.env.NO_PROXY || "").split(/[,\s]+/),
        ...(process.env.no_proxy || "").split(/[,\s]+/),
        ...(configuration.bypass ?? []),
        "localhost",
        "127.0.0.1",
        "[::1]",
        "::1",
      ].filter(Boolean),
    ),
  ].join(",")
  return {
    ...(configuration.enabled === false
      ? Object.fromEntries(proxyVariables.map((key) => [key, undefined]))
      : configuration.proxy
        ? Object.fromEntries(proxyVariables.slice(0, 4).map((key) => [key, configuration.proxy]))
        : {}),
    NO_PROXY: configuration.enabled === false ? "*" : bypass,
    no_proxy: configuration.enabled === false ? "*" : bypass,
  }
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
    if (typeof Bun !== "undefined" && proxy) return Bun.fetch(input, { ...init, proxy })
    if (typeof Bun !== "undefined" && !proxyVariables.some((key) => process.env[key]))
      return globalThis.fetch(input, init)
    // The explicit entrypoint avoids Bun's built-in "undici" shim, which delegates back to global fetch.
    const { Agent, ProxyAgent, fetch } = await import("undici/index.js")
    if (proxy && !agents.has(proxy)) agents.set(proxy, new ProxyAgent(proxy))
    if (!proxy && !direct.agent) direct.agent = new Agent()
    const options = { ...init }
    Object.defineProperty(options, "dispatcher", { value: proxy ? agents.get(proxy) : direct.agent, enumerable: true })
    if (typeof Bun !== "undefined") {
      // Bun 1.4.2 has no per-request environment-proxy bypass. Use a direct dispatcher instead of mutating process.env.
      const request = new Request(input, init)
      const response = await fetch(request.url, {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        body: request.body,
        signal: request.signal,
        redirect: request.redirect,
        duplex: "half",
        dispatcher: direct.agent,
      })
      const result = new Response(response.body as ReadableStream<Uint8Array> | null, {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers),
      })
      Object.defineProperties(result, { url: { value: response.url }, redirected: { value: response.redirected } })
      return result
    }
    return globalThis.fetch(input, options)
  },
  { preconnect: globalThis.fetch.preconnect },
)
