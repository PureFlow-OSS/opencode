import { describe, expect, test } from "bun:test"
import type { Mcp } from "@opencode/schema/mcp"
import { createMcpOperations, isMcpNotFound } from "./operations"

const calls: string[] = []

const push = (call: string) => {
  calls.push(call)
}

const operations = createMcpOperations({
  configUpdate: async (input: { mcp: { servers: Record<string, Mcp.ServerConfig | null> } }) => {
    push("configUpdate:" + JSON.stringify(input))
  },
  mcpAdd: async () => push("mcpAdd"),
  mcpRemove: async () => push("mcpRemove"),
  refresh: async () => push("refresh"),
})

describe("MCP settings operations", () => {
  test("installs durably before connecting runtime state", async () => {
    calls.length = 0
    await operations.save("jira", { type: "remote", url: "https://example.com" })
    expect(calls.slice(0, 1)).toEqual([
      "configUpdate:" + JSON.stringify({ mcp: { servers: { jira: { type: "remote", url: "https://example.com" } } } }),
    ])
    expect(calls.slice(1)).toEqual(["mcpAdd", "refresh"])
  })

  test("removes durable config, live override, and then refreshes", async () => {
    calls.length = 0
    await operations.remove("jira")
    expect(calls).toEqual(["configUpdate:{\"mcp\":{\"servers\":{\"jira\":null}}}", "mcpRemove", "refresh"])
  })

  test("recognizes 404 and server-not-found protocol errors", () => {
    expect(isMcpNotFound({ status: 404 })).toBe(true)
    expect(isMcpNotFound({ cause: { status: 404 } })).toBe(true)
    expect(isMcpNotFound(null)).toBe(false)
    expect(isMcpNotFound(new Error("MCP server not found: jira"))).toBe(false)
    expect(isMcpNotFound({ status: 401, message: "credential not found" })).toBe(false)
    expect(isMcpNotFound({ status: 500, message: "boom" })).toBe(false)
  })
})
