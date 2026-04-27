import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Auth } from "../auth"
import { Effect } from "effect"
import path from "path"
import type { Info, Model } from "../provider/provider"
import { ProviderID } from "../provider/schema"
import { ModelID } from "../provider/schema"

const MODELS_CACHE_FILE = path.join(Global.Path.data, "enterprise-models.json")
export const ENTERPRISE_PROVIDER_ID = "enterprise"

function buildEnterpriseModel(modelId: string, litellmUrl: string): Model {
  return {
    id: ModelID.make(modelId),
    providerID: ProviderID.make(ENTERPRISE_PROVIDER_ID),
    name: modelId,
    family: undefined,
    api: {
      id: modelId,
      url: litellmUrl,
      npm: "@ai-sdk/openai-compatible",
    },
    status: "active",
    headers: {},
    options: {},
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    },
    limit: {
      context: 128000,
      output: 4096,
    },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  }
}

export const loadEnterpriseProvider = Effect.fn("EnterpriseProvider.load")(function* () {
  const auth = yield* Auth.Service
  const fs = yield* AppFileSystem.Service

  const stored = yield* auth.get(ENTERPRISE_PROVIDER_ID).pipe(Effect.orDie)
  if (!stored || stored.type !== "api") return undefined

  const litellmUrl = stored.metadata?.litellm_url
  if (!litellmUrl) return undefined

  const cachedModels = yield* fs.readJson(MODELS_CACHE_FILE).pipe(
    Effect.map((data) => data as { id: string }[]),
    Effect.orElseSucceed(() => [] as { id: string }[]),
  )

  const models: Record<string, Model> = {}
  for (const m of cachedModels) {
    models[m.id] = buildEnterpriseModel(m.id, litellmUrl)
  }

  const provider: Info = {
    id: ProviderID.make(ENTERPRISE_PROVIDER_ID),
    name: "Enterprise (LiteLLM)",
    source: "api",
    env: [],
    options: {
      apiKey: stored.key,
      baseURL: litellmUrl,
    },
    models,
  }

  return provider
})

export * as EnterpriseProvider from "./provider"
