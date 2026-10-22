import { Config } from "@opencode/core/config"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Money } from "@opencode/schema/money"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { AiFactoryPlugin } from "@opencode/core/plugin/provider/aifactory"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { Provider } from "@opencode/core/provider"
import { SessionUsage } from "@opencode/core/session/usage"
import { Usage } from "@opencode/ai"
import { Document, Info } from "@opencode/schema/config"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(Layer.merge(PluginTestLayer, Config.testLayer()))
const decode = Schema.decodeUnknownSync(Info)
const decodeNormalized = Effect.fn(function* (value: Record<string, unknown>) {
  const normalized = ConfigNormalize.normalize(value)
  if (normalized.type !== "normalized") throw new Error("legacy config normalization was rejected")
  return normalized.encoded
})
const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "aifactory-test")
  yield* AiFactoryPlugin.effect(host)
})

function eventually<A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  remaining = 3000,
): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

describe("AiFactoryPlugin", () => {
  it.effect("refreshes visibility without rediscovery or retaining the startup snapshot", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { hidden: false, requests: [] as string[] }
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            const pathname = new URL(request.url).pathname
            state.requests.push(pathname)
            if (pathname === "/v1/models") return Response.json({ data: [{ id: "GLM-OCR" }] })
            if (pathname === "/modelcards.json") return Response.json({ aifactory: { models: [] } })
            return Response.json({
              aifactory: { model_visibility: state.hidden ? [{ pattern: "GLM-OCR", visible: false }] : [] },
            })
          },
        })
        return { state, server }
      }),
      ({ state, server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const models = yield* Model.Service
          const local = new Document({
            type: "document",
            info: decode({
              updater: server.url.origin,
              aifactory_host: server.url.origin,
              providers: { aifactory: { settings: { apiKey: "refresh-secret" } } },
            }),
          })
          yield* config.setEntries([
            new Document({
              type: "document",
              info: decode({ aifactory: { model_visibility: [{ pattern: "GLM-OCR", visible: false }] } }),
            }),
            local,
          ])
          const service = yield* Config.Service
          yield* addPlugin().pipe(
            Effect.provideService(Config.Service, {
              ...service,
              localEntries: () => Effect.succeed([local]),
            }),
          )
          const current = models.get(Provider.ID.make("aifactory"), Model.ID.make("GLM-OCR"))
          expect((yield* current)?.enabled).toBe(true)
          state.hidden = true
          yield* TestClock.adjust("30 seconds")
          yield* eventually(current, (model) => model?.enabled === false)
          expect((yield* models.available()).some((model) => model.id === "GLM-OCR")).toBe(false)
          state.hidden = false
          yield* TestClock.adjust("30 seconds")
          yield* eventually(current, (model) => model?.enabled === true)
          expect(state.requests.filter((path) => path === "/v1/models")).toHaveLength(1)
          expect(state.requests.filter((path) => path === "/modelcards.json")).toHaveLength(1)
          expect(state.requests.filter((path) => path === "/provider-config.json")).toHaveLength(3)
        }),
      ({ server }) => Effect.sync(() => server.stop(true)),
    ))

  test("is registered before dynamic provider plugins", () => {
    expect(AiFactoryPlugin.id).toBe("opencode.provider.aifactory")
    const ids = ProviderPlugins.map((plugin) => plugin.id)
    expect(ids.indexOf("opencode.provider.aifactory")).toBeLessThan(ids.indexOf("opencode.provider.dynamic"))
  })

  it.live("registers the integration before credentials or models exist", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const integration = yield* integrations.get(Integration.ID.make("aifactory"))
      expect(integration?.name).toBe("RRZ AI Factory")
      expect(integration?.methods.map((method) => method.type)).toEqual(["key", "env"])
      const providers = yield* Provider.Service
      expect(yield* providers.get(Provider.ID.make("aifactory"))).toBeUndefined()
    }),
  )

  it.live("discovers authenticated models and keeps tokens out of the catalog", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const requests: Array<{ authorization: string | null; header: string | null; path: string }> = []
        return {
          requests,
          server: Bun.serve({
            port: 0,
            fetch: (request) => {
              requests.push({
                authorization: request.headers.get("authorization"),
                header: request.headers.get("X-OpenCode-AiFactory-Api-Key"),
                path: new URL(request.url).pathname,
              })
              if (new URL(request.url).pathname === "/modelcards.json") {
                return Response.json({
                  aifactory: {
                    models: [
                      {
                        model: "fallback-model",
                        config: { pattern: "fallback-*" },
                        price: { input: 3, output: 4 },
                      },
                      { model: "invalid-price", config: { pattern: "invalid-*" } },
                    ],
                  },
                })
              }
              return new Response("{}", { status: 500 })
            },
          }),
        }
      }),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const config = yield* Config.Test
          const providers = yield* Provider.Service
          const models = yield* Model.Service
          yield* config.setEntries([
            new Document({
              type: "document",
              info: decode({
                aifactory_host: `${server.url.origin}/v1`,
                updater: server.url.origin,
                aifactory: {
                  model_limits: [{ pattern: "fallback-*", context: 123456, output: 4567 }],
                  model_visibility: [{ pattern: "fallback-*", visible: false }],
                },
              }),
            }),
          ])
          yield* credentials.create({
            integrationID: Integration.ID.make("aifactory"),
            value: Credential.Key.make({ type: "key", key: "test-secret" }),
            label: "Local test",
          })
          yield* addPlugin()
          yield* eventually(
            models.get(Provider.ID.make("aifactory"), Model.ID.make("fallback-model")),
            (model) => model !== undefined,
          )

          expect(requests).toContainEqual({
            authorization: null,
            header: "test-secret",
            path: "/modelcards.json",
          })
          const provider = yield* providers.get(Provider.ID.make("aifactory"))
          expect(provider?.settings).toEqual({
            baseURL: `${server.url.origin}/v1`,
            provider: "aifactory",
            apiKey: "",
          })
          expect(yield* models.get(Provider.ID.make("aifactory"), Model.ID.make("fallback-model"))).toMatchObject({
            cost: [
              {
                input: Money.USDPerMillionTokens.make(3),
                output: Money.USDPerMillionTokens.make(4),
                cache: {
                  read: Money.USDPerMillionTokens.zero,
                  write: Money.USDPerMillionTokens.zero,
                },
              },
            ],
          })
          expect(yield* models.get(Provider.ID.make("aifactory"), Model.ID.make("invalid-price"))).toMatchObject({
            cost: [
              {
                input: Money.USDPerMillionTokens.zero,
                output: Money.USDPerMillionTokens.zero,
              },
            ],
          })
          expect(JSON.stringify(yield* providers.available())).not.toContain("test-secret")
          expect(JSON.stringify(yield* models.available())).not.toContain("test-secret")
          expect(yield* models.available().pipe(Effect.map((models) => models.map((model) => model.id)))).not.toContain(
            "all-proxy-models",
          )
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("discovers models directly with the configured provider baseURL and auth headers", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const requests: Array<{ authorization: string | null; header: string | null; path: string }> = []
        return {
          requests,
          server: Bun.serve({
            port: 0,
            fetch: (request) => {
              const path = new URL(request.url).pathname
              requests.push({
                authorization: request.headers.get("authorization"),
                header: request.headers.get("X-OpenCode-AiFactory-Api-Key"),
                path,
              })
              if (path === "/modelcards.json") return new Response("{}", { status: 500 })
              return Response.json({ data: [{ id: "gpt-5.6" }, { id: "all-proxy-models" }] })
            },
          }),
        }
      }),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const credentials = yield* Credential.Service
          const models = yield* Model.Service
          const providers = yield* Provider.Service
          yield* config.setEntries([
            new Document({
              type: "document",
              info: decode({
                aifactory_host: server.url.origin + "/ignored",
                updater: server.url.origin,
                providers: { aifactory: { settings: { baseURL: server.url.origin } } },
              }),
            }),
          ])
          yield* credentials.create({
            integrationID: Integration.ID.make("aifactory"),
            value: Credential.Key.make({ type: "key", key: "direct-secret" }),
            label: "Local direct test",
          })
          yield* addPlugin()
          const model = yield* eventually(
            models.get(Provider.ID.make("aifactory"), Model.ID.make("gpt-5.6")),
            (model) => model !== undefined,
          )

          expect(requests.filter((request) => request.path === "/v1/models")).toEqual([
            { authorization: "Bearer direct-secret", header: "direct-secret", path: "/v1/models" },
          ])
          expect(model?.enabled).toBe(true)
          expect((yield* models.available()).some((model) => model.id === Model.ID.make("all-proxy-models"))).toBe(
            false,
          )
          expect(yield* models.get(Provider.ID.make("aifactory"), Model.ID.make("all-proxy-models"))).toBeDefined()
          expect((yield* providers.get(Provider.ID.make("aifactory")))?.settings?.baseURL).toBe(
            server.url.origin + "/v1",
          )
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("reloads the provider source when switching credentials with an identical token", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const paths: string[] = []
        return {
          paths,
          server: Bun.serve({
            port: 0,
            fetch: (request) => {
              paths.push(new URL(request.url).pathname)
              return Response.json({ data: [{ id: "gpt-5.6" }] })
            },
          }),
        }
      }),
      ({ paths, server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const credentials = yield* Credential.Service
          const providers = yield* Provider.Service
          const models = yield* Model.Service
          yield* config.setEntries([
            new Document({
              type: "document",
              info: decode({
                aifactory_host: server.url.origin,
                updater: server.url.origin,
              }),
            }),
          ])
          yield* addPlugin()
          expect(paths).toEqual([])
          expect(yield* providers.get(Provider.ID.make("aifactory"))).toBeUndefined()
          yield* credentials.create({
            integrationID: Integration.ID.make("aifactory"),
            value: Credential.Key.make({ type: "key", key: "same-secret" }),
            label: "first account",
          })
          const second = yield* credentials.create({
            integrationID: Integration.ID.make("aifactory"),
            value: Credential.Key.make({ type: "key", key: "same-secret" }),
            label: "second account",
            activate: false,
          })
          yield* eventually(
            models.get(Provider.ID.make("aifactory"), Model.ID.make("gpt-5.6")),
            (model) => model !== undefined,
          )
          yield* credentials.activate(second.id)
          yield* eventually(providers.snapshot(), (snapshot) => {
            const source = snapshot.records.get(Provider.ID.make("aifactory"))?.sourceConnection
            return source?.type === "credential" && source.id === second.id
          })
          expect((yield* models.available()).some((model) => model.id === Model.ID.make("gpt-5.6"))).toBe(true)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("applies rules, variants, pricing, defaults, and document workers", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const requests: Array<{ authorization: string | null; header: string | null; path: string }> = []
        return {
          requests,
          server: Bun.serve({
            port: 0,
            fetch: (request) => {
              const path = new URL(request.url).pathname
              requests.push({
                authorization: request.headers.get("authorization"),
                header: request.headers.get("X-OpenCode-AiFactory-Api-Key"),
                path,
              })
              if (path === "/v1/models")
                return Response.json({
                  data: [
                    { id: "all-proxy-models" },
                    { id: "worker-model" },
                    { id: "gpt-5.6" },
                    { id: "deepseek-r1" },
                    { id: "glm5.3" },
                    { id: "glm-5.3-flash" },
                  ],
                })
              return Response.json({
                aifactory: {
                  models: [
                    {
                      model: "gpt-5.6",
                      config: { pattern: "gpt-*" },
                      price: { input: 1, output: 2 },
                    },
                    {
                      model: "glm5.3",
                      config: { pattern: "*" },
                      price: { input: 1.801, output: 5.6604 },
                    },
                    {
                      model: "glm-5.3-flash",
                      config: { pattern: "*" },
                      price: { input: 0.193, output: 0.6432 },
                    },
                  ],
                },
              })
            },
          }),
        }
      }),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const config = yield* Config.Test
          const models = yield* Model.Service
          const providers = yield* Provider.Service
          const source = {
            model: "aifactory/gpt-5.6",
            agent: { title: { model: "aifactory/deepseek-r1" } },
            aifactory_host: server.url.origin,
            updater: server.url.origin,
            provider: { aifactory: { options: { apiKey: "legacy-secret", small_model: "all-proxy-models" } } },
            aifactory: {
              model_limits: [
                {
                  pattern: "gpt-*",
                  context: 1000,
                  output: 2000,
                  native_image_vision: true,
                  output_modalities: ["text", "audio"],
                },
                {
                  pattern: "worker-model",
                  document_ocr_model: "worker-model",
                  document_vision_native: true,
                  variants: { high: { reasoningEffort: "extreme" } },
                },
                {
                  pattern: "worker-model",
                  document_vision_model: "missing-worker",
                },
              ],
              model_visibility: [
                { pattern: "*", visible: true },
                { pattern: "gpt-5.6", visible: false },
              ],
            },
          }
          const encoded = yield* decodeNormalized(source)
          yield* config.setEntries([
            new Document({
              type: "document",
              info: decode(encoded),
            }),
          ])
          yield* addPlugin()
          const worker = yield* eventually(
            models.get(Provider.ID.make("aifactory"), Model.ID.make("worker-model")),
            (model) => model?.variants.some((variant) => variant.id === Model.VariantID.make("high")) === true,
          )
          const all = yield* models.all()
          const gpt = required(
            all.find(
              (model) => model.providerID === Provider.ID.make("aifactory") && model.id === Model.ID.make("gpt-5.6"),
            ),
          )
          const deepseek = required(
            all.find(
              (model) =>
                model.providerID === Provider.ID.make("aifactory") && model.id === Model.ID.make("deepseek-r1"),
            ),
          )
          const glm = required(
            all.find(
              (model) => model.providerID === Provider.ID.make("aifactory") && model.id === Model.ID.make("glm5.3"),
            ),
          )
          const glmFlash = required(
            all.find(
              (model) =>
                model.providerID === Provider.ID.make("aifactory") && model.id === Model.ID.make("glm-5.3-flash"),
            ),
          )
          const proxy = required(
            all.find(
              (model) =>
                model.providerID === Provider.ID.make("aifactory") && model.id === Model.ID.make("all-proxy-models"),
            ),
          )

          expect(requests.filter((request) => request.path === "/v1/models")).toEqual([
            { authorization: "Bearer legacy-secret", header: "legacy-secret", path: "/v1/models" },
          ])
          expect(requests.filter((request) => request.path === "/modelcards.json")).toEqual([
            { authorization: null, header: "legacy-secret", path: "/modelcards.json" },
          ])
          expect(worker).toMatchObject({
            enabled: true,
            capabilities: { input: ["text", "pdf", "image"] },
            variants: [{ id: Model.VariantID.make("high"), settings: { reasoningEffort: "extreme" } }],
          })
          expect(gpt).toMatchObject({
            enabled: false,
            capabilities: { input: ["text", "image"], output: ["text", "audio"] },
            limit: { context: 1000, output: 2000 },
            cost: [
              {
                input: Money.USDPerMillionTokens.make(1),
                output: Money.USDPerMillionTokens.make(2),
                cache: {
                  read: Money.USDPerMillionTokens.zero,
                  write: Money.USDPerMillionTokens.zero,
                },
              },
            ],
          })
          expect(deepseek).toMatchObject({
            enabled: true,
            variants: [
              { id: Model.VariantID.make("low"), settings: { reasoningEffort: "low" } },
              { id: Model.VariantID.make("medium"), settings: { reasoningEffort: "medium" } },
              { id: Model.VariantID.make("high"), settings: { reasoningEffort: "high" } },
            ],
          })
          expect(glm).toMatchObject({
            cost: [
              {
                input: Money.USDPerMillionTokens.make(1.801),
                output: Money.USDPerMillionTokens.make(5.6604),
              },
            ],
          })
          expect(glmFlash).toMatchObject({
            cost: [
              {
                input: Money.USDPerMillionTokens.make(0.193),
                output: Money.USDPerMillionTokens.make(0.6432),
              },
            ],
          })
          expect(proxy).toMatchObject({ enabled: true })
          expect((yield* models.available()).map((model) => model.id)).toContain(Model.ID.make("worker-model"))
          expect((yield* models.available()).map((model) => model.id)).not.toContain(Model.ID.make("gpt-5.6"))
          expect((yield* models.available()).map((model) => model.id)).toContain(Model.ID.make("all-proxy-models"))
          const missingWorker = required(
            (yield* models.all()).find(
              (model) =>
                model.providerID === Provider.ID.make("aifactory") && model.id === Model.ID.make("missing-worker"),
            ),
          )
          expect(missingWorker.enabled).toBe(false)
          expect((yield* models.available()).some((model) => model.id === Model.ID.make("missing-worker"))).toBe(false)
          expect(JSON.stringify(yield* providers.available())).not.toContain("legacy-secret")
          expect(JSON.stringify(yield* models.available())).not.toContain("legacy-secret")
          expect(
            SessionUsage.record(
              new Usage({
                nonCachedInputTokens: 1_000,
                outputTokens: 4_000,
                reasoningTokens: 1_000,
                cacheReadInputTokens: 0,
                cacheWriteInputTokens: 0,
              }),
              gpt.cost,
            ),
          ).toEqual({
            tokens: {
              input: 1_000,
              output: 3_000,
              reasoning: 1_000,
              cache: { read: 0, write: 0 },
            },
            cost: Money.USD.make((1_000 * 1 + (3_000 + 1_000) * 2) / 1_000_000),
          })
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("required value was undefined")
  return value
}
