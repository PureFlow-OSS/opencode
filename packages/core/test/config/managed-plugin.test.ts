import { expect, test } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import { Plugin } from "@opencode/schema/plugin"
import { Integration } from "@opencode/schema/integration"
import { Config } from "../../src/config.js"
import { Credential } from "../../src/credential.js"
import { ConfigManagedPlugin } from "../../src/config/managed-plugin.js"

test("plugin catalog uses the configured updater and authentication, and rejects non-registry packages", async () => {
  const seen: { url: string; key: string | null }[] = []
  const mode = { failed: false }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      seen.push({ url: new URL(request.url).pathname, key: request.headers.get("X-OpenCode-AiFactory-Api-Key") })
      if (mode.failed) return new Response("Unavailable", { status: 503 })
      return Response.json([{ name: "Tools", package: "@company/tools@1.2.3", description: "Team tools" }])
    },
  })
  try {
    expect(
      await ConfigManagedPlugin.readStore(
        fetch,
        { headers: { "X-OpenCode-AiFactory-Api-Key": "test-key" } },
        {
          updater: server.url.origin + "/opencode",
        },
      ),
    ).toEqual([{ name: "Tools", package: "@company/tools@1.2.3", description: "Team tools" }])
    expect(seen).toEqual([{ url: "/opencode/plugin-store.json", key: "test-key" }])
    const integrationID = Integration.ID.make("aifactory")
    const credential = new Credential.Info({
      id: Credential.ID.create(),
      integrationID,
      label: "default",
      value: Credential.Key.make({ type: "key", key: "stored-key" }),
    })
    const load = ConfigManagedPlugin.catalogEffect().pipe(
      Effect.provide(
        Layer.succeed(Config.Service, {
          entries: () => Effect.succeed([]),
          corporate: () => Effect.succeed({ updater: server.url.origin + "/opencode" }),
          globalPlugins: () => Effect.succeed(["@company/tools@1.2.3"]),
          changes: () => Stream.empty,
        }),
      ),
      Effect.provide(
        Layer.mock(Credential.Service)({
          list: (requested) => Effect.succeed(requested === integrationID ? [credential] : []),
        }),
      ),
    )
    const catalog = await Effect.runPromise(load)
    expect(catalog.packages).toEqual(["@company/tools@1.2.3"])
    expect(catalog.available).toBe(true)
    expect(seen.at(-1)?.key).toBe("stored-key")
    expect(JSON.stringify(catalog)).not.toContain("stored-key")
    mode.failed = true
    expect(await Effect.runPromise(load)).toEqual({
      store: [],
      available: false,
      packages: ["@company/tools@1.2.3"],
    })
    await expect(
      ConfigManagedPlugin.readStore(fetch, {}, { updater: server.url.origin + "/opencode" }),
    ).rejects.toThrow("Plugin catalog request failed")
  } finally {
    server.stop(true)
  }
  for (const value of ["plugin", "plugin@latest", "@company/plugin@1.2.3-beta.1"])
    expect(Schema.is(Plugin.Package)(value)).toBe(true)
  for (const value of ["file:///C:/plugin", "https://example.com/plugin", "../plugin", "plugin@1.0.0\n", ""])
    expect(Schema.is(Plugin.Package)(value)).toBe(false)
})
