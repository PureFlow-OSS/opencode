import type { DiscoverOptions } from "./service.js"

export function matchesVersion(version: string | undefined, options: DiscoverOptions, buildID?: string) {
  if (options.buildID !== undefined && options.buildID !== buildID) return false
  if (options.version === undefined) return true
  if (version === undefined) return false
  if (typeof options.version === "function") return options.version(version)
  return version === options.version
}
