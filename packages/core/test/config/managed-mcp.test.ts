import { expect, test } from "bun:test"
import { ConfigManagedMcp } from "../../src/config/managed-mcp.js"

test("managed MCP parsing separates server config and PAT metadata", () => {
  expect(
    ConfigManagedMcp.managed({
      mcp: {
        enterprise: {
          type: "remote",
          url: "https://example.com/mcp",
          headers: { "x-company": "value" },
          auth: { type: "pat", header: "Authorization", prefix: "Bearer " },
        },
      },
    }),
  ).toMatchObject({
    enterprise: {
      config: {
        type: "remote",
        url: "https://example.com/mcp",
        headers: { "x-company": "value" },
      },
      auth: { type: "pat", header: "Authorization", prefix: "Bearer " },
      locked: true,
      provenance: "provider-config",
    },
  })
})

test("managed MCP parsing migrates V1 updater definitions", () => {
  expect(
    ConfigManagedMcp.managed({
      mcp: {
        enterprise: {
          type: "remote",
          url: "https://example.com/mcp",
          enabled: false,
          use_http_proxy: true,
          timeout: 3000,
          oauth: {
            clientId: "client",
            clientSecret: "secret",
            scope: "read",
            callbackPort: 19876,
            redirectUri: "https://example.com/callback",
          },
        },
        local: {
          type: "local",
          command: ["npx", "mcp-server"],
          enabled: false,
          timeout: 3000,
        },
      },
    }),
  ).toMatchObject({
    enterprise: {
      config: {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: {
          client_id: "client",
          client_secret: "secret",
          scope: "read",
          callback_port: 19876,
          redirect_uri: "https://example.com/callback",
        },
        disabled: true,
        use_http_proxy: true,
        timeout: { startup: 3000, catalog: 3000, execution: 3000 },
      },
      locked: true,
      provenance: "provider-config",
    },
    local: {
      config: {
        type: "local",
        command: ["npx", "mcp-server"],
        disabled: true,
        timeout: { startup: 3000, catalog: 3000, execution: 3000 },
      },
      locked: true,
      provenance: "provider-config",
    },
  })
})

test("managed MCP parsing preserves native V2 fields", () => {
  expect(
    ConfigManagedMcp.managed({
      mcp: {
        remote: {
          type: "remote",
          url: "https://example.com/mcp",
          disabled: true,
          codemode: false,
          protocol: "2026-07-28",
          timeout: { startup: 1000, catalog: 2000, execution: 3000 },
        },
        local: {
          type: "local",
          command: ["server"],
          disabled: true,
          codemode: false,
          protocol: "auto",
          timeout: { startup: 1000 },
        },
      },
    }),
  ).toMatchObject({
    remote: {
      config: {
        disabled: true,
        codemode: false,
        protocol: "2026-07-28",
        timeout: { startup: 1000, catalog: 2000, execution: 3000 },
      },
    },
    local: {
      config: {
        disabled: true,
        codemode: false,
        protocol: "auto",
        timeout: { startup: 1000 },
      },
    },
  })
})

test("managed MCP parsing migrates legacy OAuth keys without a numeric timeout", () => {
  expect(
    ConfigManagedMcp.managed({
      mcp: {
        enterprise: {
          type: "remote",
          url: "https://example.com/mcp",
          oauth: { clientId: "client", redirectUri: "https://example.com/callback" },
        },
      },
    }),
  ).toMatchObject({
    enterprise: {
      config: {
        oauth: { client_id: "client", redirect_uri: "https://example.com/callback" },
      },
    },
  })
})

test("managed MCP parsing ignores invalid entries without dropping valid ones", () => {
  expect(
    Object.entries(
      ConfigManagedMcp.managed({
        mcp: {
          valid: { type: "remote", url: "https://example.com/mcp" },
          invalid: { type: "remote" },
          notRecord: 2,
          invalidAuth: { type: "remote", url: "https://example.com/auth", auth: { type: "oauth" } },
        },
      }),
    ),
  ).toMatchObject([
    [
      "valid",
      {
        config: { type: "remote", url: "https://example.com/mcp" },
        locked: true,
        provenance: "provider-config",
      },
    ],
    [
      "invalidAuth",
      {
        config: { type: "remote", url: "https://example.com/auth" },
        locked: true,
        provenance: "provider-config",
      },
    ],
  ])
})

test("MCP store decoding ignores invalid items", () => {
  expect(
    ConfigManagedMcp.store([
      { name: "Jira", url: "https://example.com/jira", lockedHeaderNames: ["x-jira-token"] },
      { name: "Missing url", lockedHeaderNames: [] },
      "invalid",
    ]),
  ).toStrictEqual([{ name: "Jira", url: "https://example.com/jira", lockedHeaderNames: ["x-jira-token"] }])
})

test("MCP store decoding accepts updater header-name field", () => {
  expect(
    ConfigManagedMcp.store([
      { name: "Jira", url: "https://example.com/jira", headerNames: ["x-jira-token"] },
      { name: "Missing headers", url: "https://example.com/no-headers" },
    ]),
  ).toStrictEqual([
    { name: "Jira", url: "https://example.com/jira", lockedHeaderNames: ["x-jira-token"] },
  ])
})

test("MCP store decoding preserves the OAuth required flag", () => {
  expect(
    ConfigManagedMcp.store([
      { name: "Required", url: "https://example.com/required", lockedHeaderNames: [], oauthRequired: true, use_http_proxy: true },
      { name: "Optional", url: "https://example.com/optional", lockedHeaderNames: [], oauthRequired: false },
      { name: "Default", url: "https://example.com/default", lockedHeaderNames: [] },
    ]),
  ).toStrictEqual([
    { name: "Required", url: "https://example.com/required", lockedHeaderNames: [], oauthRequired: true, use_http_proxy: true },
    { name: "Optional", url: "https://example.com/optional", lockedHeaderNames: [], oauthRequired: false },
    { name: "Default", url: "https://example.com/default", lockedHeaderNames: [] },
  ])
})

test("MCP catalog combines managed servers and store items", () => {
  expect(
    ConfigManagedMcp.catalog({
      payload: { mcp: { enterprise: { type: "remote", url: "https://example.com/mcp" } } },
      store: [{ name: "Jira", url: "https://example.com/jira", lockedHeaderNames: [] }],
    }),
  ).toMatchObject({
    managed: {
      enterprise: {
        config: { type: "remote", url: "https://example.com/mcp" },
        locked: true,
        provenance: "provider-config",
      },
    },
    store: [{ name: "Jira", url: "https://example.com/jira", lockedHeaderNames: [] }],
  })
})

test("MCP store reads the trusted updater URL and decodes successful responses", async () => {
  const requests: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      requests.push(request.url)
      return Response.json([
        { name: "Jira", description: "Jira integration", url: "https://example.com/jira", lockedHeaderNames: [] },
        { name: "Missing url", lockedHeaderNames: [] },
      ])
    },
  })
  try {
    expect(await ConfigManagedMcp.readStore(undefined, { headers: { authorization: "Bearer test" } }, { updater: server.url.toString() })).toStrictEqual([
      { name: "Jira", description: "Jira integration", url: "https://example.com/jira", lockedHeaderNames: [] },
    ])
    expect(requests).toEqual([`${server.url}mcp-store.json`])
  } finally {
    server.stop(true)
  }
})
