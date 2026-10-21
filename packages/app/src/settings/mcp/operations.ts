import type { Mcp } from "@opencode/schema/mcp"

export type McpOperations = {
  readonly save: (name: string, config: Mcp.ServerConfig, options?: { disrupts?: boolean }) => Promise<boolean>
  readonly remove: (name: string) => Promise<boolean>
}

export function createMcpOperations(input: {
  configUpdate: (patch: { mcp: { servers: Record<string, Mcp.ServerConfig | null> } }) => Promise<void>
  mcpAdd: (input: { name: string; config: Mcp.ServerConfig }) => Promise<void>
  mcpRemove: (input: { name: string }) => Promise<void>
  refresh: () => Promise<void>
  confirmDisruption?: () => Promise<boolean>
}): McpOperations {
  const confirm = async (disrupts: boolean) => {
    if (!disrupts || !input.confirmDisruption) return true
    return await input.confirmDisruption()
  }

  return {
    save: async (name, config, options) => {
      if (!(await confirm(options?.disrupts ?? false))) return false
      await input.configUpdate({ mcp: { servers: { [name]: config } } })
      await input.mcpAdd({ name, config })
      await input.refresh()
      return true
    },
    remove: async (name) => {
      if (!(await confirm(true))) return false
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
