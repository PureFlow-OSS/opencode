import { expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { HttpProxy } from "@opencode/util/http-proxy"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ChatGPTPlugin } from "@opencode/core/plugin/provider/chatgpt"
import { OpenAIPlugin } from "@opencode/core/plugin/provider/openai"
import { PluginTestLayer } from "../../plugin/fixture"

HttpProxy.configure({ use_http_proxy: true, http_proxy: process.env.FIXTURE_PROXY })

await Effect.runPromise(
  Effect.gen(function* () {
    if (process.env.FIXTURE_METHOD === "mcp") {
      const send = yield* McpOAuth.loggedFetch({ server: "https-proxy-fixture" })
      const discovery = yield* Effect.promise(() =>
        McpOAuth.configuredDiscovery({
          config: new ConfigMCP.Remote({
            type: "remote",
            url: "https://mcp.hubspot.com/mcp",
            oauth: { auth_server_metadata_url: "https://oauth.hubspot.com/metadata" },
          }),
          fetchFn: send,
        }),
      )
      expect(discovery?.authorizationServerMetadata?.token_endpoint).toBe("https://oauth.hubspot.com/token")
      const response = yield* Effect.promise(() =>
        send("https://mcp.hubspot.com/mcp", { headers: { authorization: "Bearer resource-token" } }),
      )
      expect(yield* Effect.promise(() => response.json())).toEqual({ authorization: "Bearer resource-token" })
      const token = yield* Effect.promise(() =>
        send("https://oauth.hubspot.com/token", {
          method: "POST",
          body: new URLSearchParams({ grant_type: "authorization_code", code: "fixture-code" }),
        }),
      )
      expect(token.status).toBe(200)
      const redirect = yield* Effect.promise(() => send("https://mcp.hubspot.com/redirect"))
      expect(redirect.status).toBe(200)
      return
    }

    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin)
    yield* process.env.FIXTURE_METHOD === "chatgpt-token-sharing"
      ? ChatGPTPlugin.effect(host)
      : OpenAIPlugin.effect(host)
    const integrations = yield* Integration.Service
    const integrationID = Integration.ID.make("openai")
    const attempt = yield* integrations.oauth.connect({
      integrationID,
      methodID: Integration.MethodID.make(process.env.FIXTURE_METHOD!),
    })
    if (process.env.FIXTURE_METHOD !== "chatgpt-headless") {
      const authorization = new URL(attempt.url)
      yield* Effect.promise(() =>
        fetch(process.env.FIXTURE_CONTROL!, { method: "POST", body: authorization.searchParams.get("nonce") ?? "" }),
      )
      const callback = new URL(authorization.searchParams.get("redirect_uri")!)
      callback.searchParams.set("state", authorization.searchParams.get("state")!)
      callback.searchParams.set("code", "fixture-code")
      if (process.env.FIXTURE_METHOD === "chatgpt-token-sharing")
        callback.searchParams.set("client_id", "fixture-client")
      const response = yield* Effect.promise(() => HttpProxy.fetch(callback))
      expect(response.status).toBe(200)
    }
    const status = yield* integrations.oauth
      .status({ integrationID, attemptID: attempt.attemptID })
      .pipe(
        Effect.repeat({ until: (value) => value.status !== "pending", schedule: Schedule.spaced("10 millis") }),
        Effect.timeout("5 seconds"),
      )
    expect(status.status).toBe("complete")
    const credentials = yield* Credential.Service
    const saved = (yield* credentials.list(integrationID)).at(-1)
    expect(saved?.value).toMatchObject({
      type: "oauth",
      access: "fixture-access",
      refresh: "fixture-refresh",
    })
    if (!saved || saved.value.type !== "oauth") throw new Error("Missing OAuth credential")
    yield* credentials.update(saved.id, { value: Credential.OAuth.make({ ...saved.value, expires: 1 }) })
    expect(
      yield* integrations.connection.resolve({
        type: "credential",
        id: saved.id,
        label: saved.label,
        method: "oauth",
      }),
    ).toMatchObject({ access: "fixture-access", expires: expect.any(Number) })
  }).pipe(Effect.scoped, Effect.provide(PluginTestLayer)),
)
console.log("PROXY_FIXTURE_OK")
process.exit(0)
