import { createStore, unwrap } from "solid-js/store"
import { ServerScope } from "@/runtime/server/scope"

import { mcpCatalogReady, recordMcpWrite } from "@/settings/mcp/mcp.fixture"

const providers = [
  "opencode-go",
  "opencode",
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "vercel",
  "github-copilot",
  "302ai",
  "abacus",
  "abliteration",
  "alibaba",
  "alibaba-cn",
  "alibaba-coding-plan",
]

const initialConfigEntries = [
  {
    type: "document",
    info: {
      mcp: {
        servers: {
          "Local tools": { type: "local", command: ["local-mcp"] },
        },
      },
    },
  },
]

const initialRuntime = [
  { name: "Local tools", status: { status: "connected" } },
  { name: "Company search", status: { status: "disabled" } },
]

export const [mcpStoryState, setMcpStoryState] = createStore({
  configEntries: initialConfigEntries,
  runtime: initialRuntime,
})

const snapshot = () => structuredClone(unwrap(mcpStoryState))

const client = {
  provider: {
    auth: async () => ({
      data: Object.fromEntries(providers.map((provider) => [provider, [{ type: "api", label: "API key" }]])),
    }),
    oauth: {
      authorize: async (input: { method?: number }) => ({
        data: {
          url: "https://example.com/oauth",
          method: input.method === 1 ? ("code" as const) : ("auto" as const),
          instructions: input.method === 1 ? "Paste the authorization code" : "Confirmation code: ABCD-EFGH",
        },
      }),
      callback: async (input: { method?: number }) => {
        if (input.method === 0) return new Promise<never>(() => {})
        return { data: undefined }
      },
    },
  },
  auth: {
    set: async () => ({ data: true }),
  },
  global: {
    dispose: async () => ({ data: true }),
  },
}

const api = {
  session: {
    form: {
      reply: async () => ({ data: true }),
      cancel: async () => ({ data: true }),
    },
  },
  config: {
    get: async () => snapshot().configEntries,
    update: async (input: { mcp?: { servers?: Record<string, unknown> } }) => {
      recordMcpWrite("config.update")
      const entries = snapshot().configEntries
      const servers: Record<string, unknown> = entries[0].info.mcp.servers
      for (const [name, config] of Object.entries(input.mcp?.servers ?? {})) {
        if (config === null) delete servers[name]
        else servers[name] = config
      }
      setMcpStoryState("configEntries", entries)
      return { data: true }
    },
  },
  mcp: {
    list: async () => ({ data: snapshot().runtime }),
    add: async (input: { server: string }) => {
      recordMcpWrite(`mcp.add:${input.server}`)
      setMcpStoryState(
        "runtime",
        mcpStoryState.runtime
          .filter((server) => server.name !== input.server)
          .concat({
            name: input.server,
            status: { status: "connected" },
          }),
      )
      return { data: true }
    },
    remove: async (input: { server: string }) => {
      recordMcpWrite(`mcp.remove:${input.server}`)
      setMcpStoryState(
        "runtime",
        mcpStoryState.runtime.filter((server) => server.name !== input.server),
      )
      return { data: true }
    },
    catalog: async () => {
      await mcpCatalogReady()
      return {
        data: {
          managed: {
            "Company search": {
              config: {
                type: "remote",
                url: "https://mcp.example/search",
                headers: { "x-company-token": "" },
                oauth: false,
              },
              auth: { type: "pat", header: "x-company-token" },
              locked: true,
            },
          },
          store: [
            {
              name: "Company docs",
              description: "Search company documentation",
              url: "https://mcp.example/docs",
              lockedHeaderNames: ["x-company-token"],
              oauthRequired: false,
            },
            {
              name: "Company OAuth",
              url: "https://mcp.example/oauth",
              lockedHeaderNames: [],
              oauthRequired: true,
            },
          ],
        },
      }
    },
    connect: async (input: { server: string }) => {
      recordMcpWrite(`mcp.connect:${input.server}`)
      setMcpStoryState(
        "runtime",
        mcpStoryState.runtime.map((server) =>
          server.name === input.server ? { ...server, status: { status: "connected" } } : server,
        ),
      )
      return { data: true }
    },
    disconnect: async (input: { server: string }) => {
      recordMcpWrite(`mcp.disconnect:${input.server}`)
      setMcpStoryState(
        "runtime",
        mcpStoryState.runtime.map((server) =>
          server.name === input.server ? { ...server, status: { status: "disabled" } } : server,
        ),
      )
      return { data: true }
    },
  },
  plugin: {
    list: async () => ({
      data: [{ id: "Storybook plugin", source: { type: "package", target: "@example/plugin" } }],
    }),
  },
}

export function useServerSDK() {
  return {
    scope: ServerScope.local,
    url: "http://storybook.local",
    api,
    client,
    connection: {
      status: () => "connected",
      attempt: () => 0,
      error: () => undefined,
    },
    event: {
      on: () => () => {},
    },
  }
}
