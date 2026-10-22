import { expect, test } from "bun:test"
import { ConfigManaged } from "../../src/config/managed.js"

test("central configuration caches successful responses separately for each API key", async () => {
  const keys: (string | null)[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const key = request.headers.get(ConfigManaged.PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER)
      keys.push(key)
      return Response.json({ Updater: { ProviderConfig: { model: key === "first" ? "model-one" : "model-two" } } })
    },
  })
  try {
    const config = { updater: server.url.toString() }
    const first = ConfigManaged.providerConfigRequestInit({ auth: { aifactory: { type: "key", key: "first" } } })
    const second = ConfigManaged.providerConfigRequestInit({ auth: { aifactory: { type: "key", key: "second" } } })
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, first, config)).toEqual({ model: "model-one" })
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, second, config)).toEqual({ model: "model-two" })
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, first, config)).toEqual({ model: "model-one" })
    expect(keys).toEqual(["first", "second"])
  } finally {
    server.stop(true)
  }
})

test("failed configuration requests are retried and wrapped payloads are accepted", async () => {
  const attempts = { count: 0 }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      attempts.count++
      return attempts.count === 1
        ? new Response("unavailable", { status: 503 })
        : Response.json({ updater: { providerConfig: { model: "available" } } })
    },
  })
  try {
    const config = { updater: server.url.toString() }
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, {}, config)).toEqual({})
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, {}, config)).toEqual({ model: "available" })
    expect(attempts.count).toBe(2)
  } finally {
    server.stop(true)
  }
})

test("refresh bypasses the cache and retains the last valid payload on failure", async () => {
  const attempts = { count: 0 }
  const responses = [
    Response.json({ Updater: { ProviderConfig: { model: "initial" } } }),
    Response.json({ updater: { providerConfig: { model: "refreshed" } } }),
    new Response("unavailable", { status: 503 }),
    Response.json([]),
    Response.json({ Updater: { ProviderConfig: [] } }),
    Response.json({ Updater: { ProviderConfig: {} } }),
    new Response("{", { status: 200 }),
  ]
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => responses[attempts.count++] ?? new Response("missing", { status: 500 }),
  })
  try {
    const config = { updater: server.url.toString() }
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, {}, config)).toEqual({ model: "initial" })
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, {}, config)).toEqual({ model: "initial" })
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, {}, config, { refresh: true })).toEqual({
      model: "refreshed",
    })
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, {}, config, { refresh: true })).toEqual({
      model: "refreshed",
    })
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, {}, config, { refresh: true })).toEqual({
      model: "refreshed",
    })
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, {}, config, { refresh: true })).toEqual({
      model: "refreshed",
    })
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, {}, config, { refresh: true })).toEqual({})
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, {}, config)).toEqual({})
    expect(await ConfigManaged.readProviderConfig(Bun.fetch, {}, config, { refresh: true })).toEqual({})
    expect(attempts.count).toBe(7)
  } finally {
    server.stop(true)
  }
})
