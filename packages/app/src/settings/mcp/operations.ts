import type { Mcp } from "@opencode/schema/mcp"

export type McpOperations = {
  readonly save: (name: string, config: Mcp.ServerConfig) => Promise<void>
  readonly remove: (name: string) => Promise<boolean>
}

export function createMcpOperations(input: {
  configUpdate: (patch: { mcp: { servers: Record<string, Mcp.ServerConfig | null> } }) => Promise<void>
  mcpAdd: (input: { name: string; config: Mcp.ServerConfig }) => Promise<void>
  mcpRemove: (input: { name: string }) => Promise<void>
  refresh: () => Promise<void>
}): McpOperations {
  return {
    save: async (name, config) => {
      await input.configUpdate({ mcp: { servers: { [name]: config } } })
      await input.mcpAdd({ name, config })
      await input.refresh()
    },
    remove: async (name) => {
      await input.configUpdate({ mcp: { servers: { [name]: null } } })
      // Runtime overrides are process-local; a 404 means durable config already removed the server.
      const removed = await input.mcpRemove({ name }).then(
        () => true,
        (error: unknown) => {
          if (!isMcpNotFound(error)) throw error
          return false
        },
      )
      await input.refresh()
      return removed
    },
  }
}

export function isMcpNotFound(error: unknown) {
  if (error === null || typeof error !== "object") return false
  const value = error as { readonly status?: unknown; readonly cause?: { readonly status?: unknown } | null }
  return value.status === 404 || value.cause?.status === 404
}
