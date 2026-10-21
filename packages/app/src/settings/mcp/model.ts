import type { Mcp } from "@opencode/schema/mcp"
import { isDeepEqual } from "remeda"

export type ManagedCatalog = {
  readonly managed: Record<string, Mcp.ManagedServer>
  readonly store: Mcp.StoreItem[]
}

export type ServerRow = {
  name: string
  source: "managed" | "local"
  config: Mcp.ServerConfig
  override?: Mcp.ServerConfig
  locked: boolean
  auth?: Mcp.PatAuth
}

export type ConfigEntry = { type?: string; info?: { mcp?: { servers?: Record<string, Mcp.ServerConfig> } } }

export function configuredServers(entries: readonly ConfigEntry[]): Record<string, Mcp.ServerConfig> {
  return Object.fromEntries(
    entries.flatMap((entry) => (entry.type === "document" ? Object.entries(entry.info?.mcp?.servers ?? {}) : [])),
  )
}

export function serverRows(input: { entries: readonly ConfigEntry[]; catalog: ManagedCatalog }): ServerRow[] {
  const configured = configuredServers(input.entries)
  const names = [...new Set([...Object.keys(configured), ...Object.keys(input.catalog.managed)])]

  const rows = names
    .map((name): ServerRow | undefined => {
      const managed = input.catalog.managed[name]
      const config = configured[name]
      if (managed)
        return {
          name,
          source: "managed" as const,
          config: managed.config,
          override: config && !isDeepEqual(config, managed.config) ? config : undefined,
          locked: managed.locked ?? true,
          auth: managed.auth,
        }
      if (config) return { name, source: "local" as const, config, locked: false }
    })
    .filter((row): row is ServerRow => row !== undefined)
  return rows.toSorted((a, b) => a.name.localeCompare(b.name))
}

export function patValue(row: ServerRow) {
  if (row.source !== "managed" || row.auth?.type !== "pat" || row.override?.type !== "remote") return ""
  const header = row.auth.header ?? "Authorization"
  const prefix = row.auth.prefix ?? ""
  const value = row.override.headers?.[header] ?? ""
  return prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value
}

export function patConfig(row: ServerRow, token: string): Mcp.RemoteConfig | undefined {
  if (row.source !== "managed" || row.config.type !== "remote" || row.auth?.type !== "pat") return
  const header = row.auth.header ?? "Authorization"
  const prefix = row.auth.prefix ?? ""
  const headers = { ...(row.config.headers ?? {}), ...(row.override?.type === "remote" ? row.override.headers : {}) }
  return { ...row.config, headers: { ...headers, [header]: `${prefix}${token}` } }
}

export function storeConfig(item: Mcp.StoreItem): Mcp.RemoteConfig {
  return {
    type: "remote",
    url: item.url,
    headers: Object.fromEntries(item.lockedHeaderNames.map((header) => [header, ""])),
    oauth: item.oauthRequired === true ? {} : false,
    disabled: false,
  }
}

export function isValidRemoteUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function subtitle(row: ServerRow) {
  const config = row.override ?? row.config
  return config.type === "local" ? config.command.join(" ") : config.url
}
