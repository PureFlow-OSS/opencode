import { define } from "@opencode/plugin/effect/plugin"
import { isRecord } from "@opencode/ai/utils/record"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Bus } from "../../bus.js"
import { Config } from "../../config.js"
import { ConfigManaged } from "../../config/managed.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { Money } from "@opencode/schema/money"
import { Provider } from "../../provider.js"
import { Variant } from "../../variant.js"
import { Event } from "@opencode/schema/config"
import { HttpProxy } from "@opencode/util/http-proxy"
import { Duration, Effect, Schema, Stream } from "effect"

const integrationID = Integration.ID.make("aifactory")
const providerID = Provider.ID.make("aifactory")
const defaultBaseURL = "http://10.53.7.23/v1"
const discoveryTimeout = Duration.toMillis("5 seconds")
const hiddenDefaults = ["*embedding*", "all-proxy-models", "all-team-models"]
const noModels: readonly never[] = []

export const AiFactoryPlugin = define({
  id: "opencode.provider.aifactory",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const http = yield* HttpClient.HttpClient
    const serviceFetch = yield* FetchHttpClient.Fetch

    yield* ctx.integration.transform((editor) => {
      editor.update("aifactory", (integration) => {
        integration.name = "RRZ AI Factory"
      })
      editor.method.update({ integrationID, method: { type: "key", label: "API key" } })
      editor.method.update({ integrationID, method: { type: "env", names: ["OPENCODE_AIFACTORY_API_KEY"] } })
    })

    let token = ""
    let baseURL = defaultBaseURL
    let definitions: readonly Model.Info[] = []
    let connection: IntegrationConnection.Info | undefined
    let connectionID = ""

    const load = Effect.fn("AiFactoryPlugin.load")(function* () {
      const settings = yield* (config.corporate ? config.corporate() : Effect.map(config.entries(), Config.corporateSettings))
      const active = yield* ctx.integration.connection.active("aifactory").pipe(Effect.orElseSucceed(() => undefined))
      const credential = active
        ? yield* ctx.integration.connection.resolve(active).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const init = ConfigManaged.providerConfigRequestInit({
        config: settings,
        auth: credential?.type === "key" ? { aifactory: credential } : undefined,
      })
      const nextToken =
        new Headers(init.headers).get(ConfigManaged.PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER)?.trim() ?? ""
      const nextBaseURL = aiFactoryBaseURL(settings)
      const nextConnectionID = active?.type === "credential" ? active.id : active ? active.type : ""
      const providerConfig = nextToken
        ? yield* Effect.promise(() =>
          ConfigManaged.readProviderConfig(
            serviceFetch === globalThis.fetch ? HttpProxy.fetch : serviceFetch,
            init,
            settings,
          ),
          )
        : {}
      const ids = nextToken ? yield* discover(http, nextToken, nextBaseURL) : noModels
      const cards = nextToken && ids.length === 0 ? yield* modelCards(http, nextToken, settings) : []
      const fallback = cards.flatMap((card) => (card.model?.trim() ? [card.model.trim()] : []))
      const allEntries = yield* config.entries()
      const localAIFactory = Config.latest(allEntries, "aifactory")
      const providers = Config.latest(allEntries, "providers") ?? {}
      const title = Config.latest(allEntries, "agents")?.title
      const defaults = [
        ...selectionModels(Config.latest(allEntries, "model")),
        ...selectionModels(title?.model),
        ...selectionModels(providerConfig.model),
        rawModel(providerConfig.small_model),
        rawModel(record(record(providers.aifactory).options).small_model),
        rawModel(record(record(providers.aifactory).settings).small_model),
      ].flatMap((value) => (value ? [value] : []))
      const limits = [
        ...rules(record(localAIFactory).model_limits),
        ...rules(record(providerConfig.aifactory).model_limits),
      ]
      const visibility = [
        ...visibilityRules(record(localAIFactory).model_visibility),
        ...visibilityRules(record(providerConfig.aifactory).model_visibility),
      ]
      const next = catalog(ids.length > 0 ? ids : fallback, limits, visibility, defaults, cards)

      if (
        nextToken === token &&
        nextBaseURL === baseURL &&
        nextConnectionID === connectionID &&
        sameModels(next, definitions)
      )
        return
      token = nextToken
      baseURL = nextBaseURL
      definitions = next
      connectionID = nextConnectionID
      connection = active?.type === "credential" ? { ...active, id: Credential.ID.make(active.id) } : active
      yield* ctx.integration.reload()
      yield* ctx.provider.reload()
    })

    yield* ctx.provider.transform((providers) => {
      if (definitions.length === 0) return
      providers.add({
        info: {
          id: providerID,
          integrationID,
          name: "RRZ AI Factory",
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL, provider: "aifactory", apiKey: "" },
        },
        models: definitions,
        sourceConnection: connection,
      })
    })

    yield* ctx.session.hook(
      "model.request",
      (event) =>
        Effect.sync(() => {
          if (!token || event.model.providerID !== providerID) return
          event.baseURL = baseURL
          event.headers.authorization = `Bearer ${token}`
          event.headers[ConfigManaged.PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER] = token
        }),
      { providerID },
    )

    yield* load()
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(() => load()),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* bus.subscribe(Event.Updated).pipe(
      Stream.filter(() => true),
      Stream.runForEach(() => load()),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

function aiFactoryBaseURL(settings: Config.Corporate) {
  const provider = record(record(settings.providers).aifactory)
  const configured = record(provider.settings ?? provider.options).baseURL
  const host =
    (typeof configured === "string" ? configured.trim() : undefined) ||
    settings.aifactory_host?.trim() ||
    process.env.OPENCODE_AIFACTORY_HOST?.trim() ||
    defaultBaseURL
  const trimmed = host.replace(/\/+$/, "")
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`
}

function discover(http: HttpClient.HttpClient, token: string, endpoint: string) {
  return http
    .execute(
      HttpClientRequest.get(`${endpoint.replace(/\/+$/, "")}/models`).pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeader(ConfigManaged.PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER, token),
      ),
    )
    .pipe(
      Effect.timeout(discoveryTimeout),
      Effect.flatMap((response) =>
        HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap(() => HttpClientResponse.schemaBodyJson(Schema.Unknown)(response)),
        ),
      ),
      Effect.map((payload) => {
        const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : []
        return data.flatMap((item) =>
          isRecord(item) && typeof item.id === "string" && item.id.trim() ? [item.id.trim()] : [],
        )
      }),
      Effect.orElseSucceed(() => []),
    )
}

function definition(id: string, limits: Rule[], visibility: VisibilityRule[], defaults: readonly string[]): Model.Info {
  const info = rule(id, limits)
  return {
    id: Model.ID.make(id),
    modelID: Model.ID.make(id),
    providerID,
    name: id,
    family: Model.Family.make(id.split(/[-/]/)[0]),
    package: "@opencode/ai/providers/openai-compatible",
    settings: info.options,
    capabilities: { tools: true, input: info.input, output: info.outputModalities, temperature: info.temperature },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: visible(id, visibility, defaults),
    limit: { context: info.context, output: info.output },
  }
}

type Rule = {
  pattern: string
  context?: number
  output?: number
  temperature?: boolean
  reasoning?: boolean
  document_vision?: boolean
  document_vision_native?: boolean
  document_ocr_native_pdf?: boolean
  native_image_vision?: boolean
  document_ocr_model?: string
  document_vision_model?: string
  input?: string[]
  output_modalities?: string[]
  modalities?: { input?: string[]; output?: string[] }
  options?: Record<string, unknown>
  variants?: Record<string, Record<string, unknown>>
}

type VisibilityRule = { pattern: string; visible: boolean }

type ModelCard = {
  model?: string
  config?: { pattern?: string | null } | null
  price?: { input?: number | null; output?: number | null } | null
  liteLLM?: { inputCostPerMillionTokens?: number | null; outputCostPerMillionTokens?: number | null } | null
}

function record(value: unknown) {
  return isRecord(value) ? value : {}
}

function selectionModels(value: unknown) {
  const selection = record(value)
  return selection.providerID === "aifactory" ? [rawModel(selection.model)] : []
}

function rawModel(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().replace(/^aifactory\//, "") : undefined
}

function rules(value: unknown): Rule[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => (isRecord(item) && typeof item.pattern === "string" ? [item as unknown as Rule] : []))
}

function visibilityRules(value: unknown): VisibilityRule[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) =>
    isRecord(item) && typeof item.pattern === "string" && typeof item.visible === "boolean"
      ? [item as unknown as VisibilityRule]
      : [],
  )
}

function modelCards(http: HttpClient.HttpClient, token: string, settings: Config.Corporate) {
  return http
    .execute(
      HttpClientRequest.get(`${ConfigManaged.updateBaseUrl(settings)}/modelcards.json`).pipe(
        HttpClientRequest.setHeader(ConfigManaged.PROVIDER_CONFIG_AIFACTORY_API_KEY_HEADER, token),
      ),
    )
    .pipe(
      Effect.timeout(discoveryTimeout),
      Effect.flatMap((response) =>
        HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap(() => HttpClientResponse.schemaBodyJson(Schema.Unknown)(response)),
        ),
      ),
      Effect.map(decodeModelCards),
      Effect.orElseSucceed(() => []),
    )
}

function decodeModelCards(value: unknown): ModelCard[] {
  const models = isRecord(value) && isRecord(value.aifactory) && Array.isArray(value.aifactory.models) ? value.aifactory.models : []
  return models.flatMap((item) => (isRecord(item) ? [item as unknown as ModelCard] : []))
}

function score(pattern: string, modelID: string) {
  if (pattern === "*") return 0
  if (pattern.toLowerCase() === modelID.toLowerCase()) return 1000 + pattern.length
  const expression = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  if (new RegExp(`^${expression}$`, "i").test(modelID))
    return 100 - (pattern.split("*").length - 1) * 10 + pattern.length
  return -1
}

function matches(pattern: string, modelID: string) {
  const expression = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${expression}$`, "i").test(modelID)
}

function rule(modelID: string, limits: Rule[]) {
  const item = limits
    .map((item) => ({ item, score: score(item.pattern, modelID) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .at(0)?.item
  const configuredInput = item?.input ?? item?.modalities?.input ?? ["text"]
  const documentInput = item?.document_vision_native
    ? [...new Set([...configuredInput, "pdf"])]
    : configuredInput.filter((value) => value !== "pdf")
  return {
    context: item?.context ?? 200_000,
    output: item?.output ?? 32_000,
    temperature: item?.temperature ?? true,
    reasoning: item?.reasoning ?? /(^o[134]\b)|(^gpt-5\b)|claude|reason|r1|deepseek|gemini/i.test(modelID),
    input:
      item?.native_image_vision === true
        ? [...new Set([...documentInput, "image"])]
        : documentInput.filter((value) => value !== "image"),
    outputModalities: item?.output_modalities ?? item?.modalities?.output ?? ["text"],
    options: item?.options ?? {},
    variants: item?.variants ?? {},
  }
}

function visible(modelID: string, visibility: VisibilityRule[], defaults: readonly string[]) {
  if (defaults.includes(modelID)) return true
  const item = visibility.filter((item) => matches(item.pattern, modelID)).at(-1)
  if (item) return item.visible
  return !hiddenDefaults.some((pattern) => matches(pattern, modelID))
}

function catalog(
  ids: readonly string[],
  limits: Rule[],
  visibility: VisibilityRule[],
  defaults: readonly string[],
  cards: readonly ModelCard[],
) {
  const workers = new Set(
    limits
      .flatMap((item) => [item.document_ocr_model, item.document_vision_model])
      .flatMap((id) => (typeof id === "string" && id.trim() ? [id.trim()] : [])),
  )
  return [...new Set([...ids, ...defaults, ...workers])].map((id) => {
    const base = definition(id, limits, visibility, defaults)
    const info = rule(id, limits)
    const costs = price(id, cards)
    const configuredVariants = Object.entries(info.variants).map(([id, value]) => ({
      id: Model.VariantID.make(id),
      settings: record(value),
      headers: {},
      body: {},
    }))
    const generated = info.reasoning ? Variant.resolve(base, [{ type: "effort" }]) : []
    const variants = [
      ...generated.filter((variant) => !configuredVariants.some((item) => item.id === variant.id)),
      ...configuredVariants,
    ]
    return {
      ...base,
      capabilities: {
        ...base.capabilities,
        input: workers.has(id) ? [...new Set([...base.capabilities.input, "image"])] : base.capabilities.input,
      },
      cost: [{
        input: money(costs.input),
        output: money(costs.output),
        cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
      }],
      variants,
      enabled:
        workers.has(id) && !defaults.includes(id) && (!ids.includes(id) || !visible(id, visibility, defaults))
          ? false
          : base.enabled,
    }
  })
}

function price(modelID: string, cards: readonly ModelCard[]) {
  const item = cards
    .map((card) => ({ card, pattern: card.config?.pattern?.trim() || card.model?.trim() }))
    .filter((item): item is { card: ModelCard; pattern: string } => item.pattern !== undefined)
    .map((item) => ({
      input: item.card.price?.input ?? item.card.liteLLM?.inputCostPerMillionTokens,
      output: item.card.price?.output ?? item.card.liteLLM?.outputCostPerMillionTokens,
      score: score(item.pattern, modelID),
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .at(0)
  return { input: item?.input, output: item?.output }
}

function money(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Money.USDPerMillionTokens.make(value)
    : Money.USDPerMillionTokens.zero
}

function sameModels(next: readonly Model.Info[], current: readonly Model.Info[]) {
  return JSON.stringify(next) === JSON.stringify(current)
}
