import type { McpRemoteConfig } from "@opencode-ai/sdk/v2/client"

export function isValidRemoteUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function sanitizeMcpStatusMap<T extends Record<string, { status: string }>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter(([_, value]) => value?.status !== "failed"),
  ) as T
}
