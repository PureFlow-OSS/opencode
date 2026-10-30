import { describe, expect, test } from "bun:test"
import type { Mcp } from "@opencode/schema/mcp"
import { patConfig, patValue, serverRows, storeConfig } from "./model"

const managed: Mcp.ManagedServer = {
  config: {
    type: "remote",
    url: "https://example.com/mcp",
    headers: { "x-company": "value" },
    timeout: { startup: 1000, catalog: 2000, execution: 3000 },
  },
  auth: { type: "pat", header: "Authorization", prefix: "Bearer " },
  locked: true,
  provenance: "provider-config",
}

const entry = (servers: Record<string, Mcp.ServerConfig>) => ({
  type: "document",
  info: { mcp: { servers } },
})

describe("MCP settings rows", () => {
  test("treats a central default as managed, not as a user override", () => {
    const rows = serverRows({
      entries: [entry({ enterprise: structuredClone(managed.config) })],
      catalog: { managed: { enterprise: managed }, store: [] },
    })

    expect(rows).toEqual([
      {
        name: "enterprise",
        source: "managed",
        config: managed.config,
        override: undefined,
        locked: true,
        auth: managed.auth,
      },
    ])
  })

  test("keeps a user PAT override separate from the managed base", () => {
    const override = { ...managed.config, headers: { "x-company": "value", Authorization: "Bearer token" } }

    const rows = serverRows({
      entries: [entry({ enterprise: override })],
      catalog: { managed: { enterprise: managed }, store: [] },
    })

    expect(rows[0]).toMatchObject({ source: "managed", override, locked: true })
    expect(patValue(rows[0])).toBe("token")
    expect(patConfig(rows[0], "next")?.headers).toEqual({
      "x-company": "value",
      Authorization: "Bearer next",
    })
  })

  test("keeps native OAuth fields with a scope", () => {
    const remote = managed.config.type === "remote" ? managed.config : undefined

    if (!remote) throw new Error("managed fixture must be remote")

    const oauth = {
      client_id: "client",
      scope: "read",
      callback_port: 4300,
      redirect_uri: "https://example.com/callback",
    }

    const rows = serverRows({
      entries: [entry({ enterprise: { ...remote, oauth } })],
      catalog: { managed: { enterprise: managed }, store: [] },
    })

    expect(rows[0]?.override).toEqual({ ...remote, oauth })
  })

  test("classifies configured servers without a central default as local", () => {
    const config: Mcp.ServerConfig = { type: "local", command: ["server"] }
    expect(serverRows({ entries: [entry({ custom: config })], catalog: { managed: {}, store: [] } })).toEqual([
      { name: "custom", source: "local", config, override: undefined, locked: false, auth: undefined },
    ])
  })

  test("defaults managed rows to locked", () => {
    const unlocked = { ...managed, locked: false }
    const rows = serverRows({ entries: [], catalog: { managed: { enterprise: unlocked }, store: [] } })
    expect(rows[0]).toMatchObject({ locked: false, override: undefined })
  })

  test("creates locked store header placeholders without storing a secret", () => {
    expect(
      storeConfig({
        name: "Jira",
        url: "https://example.com/jira",
        lockedHeaderNames: ["x-company", "X-LiteLLM-API-Key"],
      }),
    ).toEqual({
      url: "https://example.com/jira",
      type: "remote",
      use_http_proxy: false,
      headers: { "x-company": "", "X-LiteLLM-API-Key": "" },
      oauth: false,
      disabled: false,
    })
  })

  test.each([
    ["required", true, {}],
    ["optional opt-in", false, false],
    ["legacy missing flag", undefined, false],
  ] as const)("maps store OAuth requirement %s to explicit config", (_name, oauthRequired, oauth) => {
    expect(
      storeConfig({
        name: "Jira",
        url: "https://example.com/jira",
        lockedHeaderNames: ["x-company"],
        oauthRequired,
      }),
    ).toEqual({
      type: "remote",
      url: "https://example.com/jira",
      use_http_proxy: false,
      headers: { "x-company": "" },
      oauth,
      disabled: false,
    })
  })

  test.each([undefined, false, true])("preserves store proxy policy %s", (use_http_proxy) => {
    expect(
      storeConfig({ name: "MCP", url: "https://example.com", lockedHeaderNames: [], use_http_proxy }).use_http_proxy,
    ).toBe(use_http_proxy === true)
  })
})
