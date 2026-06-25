const UPDATE_SERVER_BASE_URL = import.meta.env.VITE_OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode"
const PROVIDER_CONFIG_URL = `${UPDATE_SERVER_BASE_URL}/provider-config.json`
const AIFACTORY_API_KEY_HEADER = "X-OpenCode-AiFactory-Api-Key"
const DEFAULT_RULES = [
  { pattern: "*embedding*", visible: false },
  { pattern: "all-proxy-models", visible: false },
  { pattern: "all-team-models", visible: false },
] as const

export type ModelVisibilityRule = {
  pattern: string
  visible: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function globToRegExp(pattern: string) {
  return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i")
}

function providerConfigPayload(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {}
  const updater = isRecord(payload.Updater) ? payload.Updater : isRecord(payload.updater) ? payload.updater : undefined
  if (!updater) return payload
  return isRecord(updater.ProviderConfig)
    ? updater.ProviderConfig
    : isRecord(updater.providerConfig)
      ? updater.providerConfig
      : payload
}

export function defaultModelVisibilityRules() {
  return [...DEFAULT_RULES]
}

export function parseAiFactoryModelVisibilityRules(payload: unknown) {
  const config = providerConfigPayload(payload)
  const aiFactory = isRecord(config.aifactory) ? config.aifactory : undefined
  if (!aiFactory || !Array.isArray(aiFactory.model_visibility)) return []
  return aiFactory.model_visibility.flatMap((rule) => {
    if (!isRecord(rule) || typeof rule.pattern !== "string" || typeof rule.visible !== "boolean") return []
    const pattern = rule.pattern.trim()
    if (!pattern) return []
    return [{ pattern, visible: rule.visible } satisfies ModelVisibilityRule]
  })
}

function buildRequestInit(input: { apiKey?: string } = {}) {
  if (!input.apiKey?.trim()) return { cache: "no-store", signal: AbortSignal.timeout(3000) } satisfies RequestInit
  return {
    cache: "no-store",
    headers: {
      [AIFACTORY_API_KEY_HEADER]: input.apiKey.trim(),
    },
    signal: AbortSignal.timeout(3000),
  } satisfies RequestInit
}

export async function readAiFactoryModelVisibilityRules(fetchFn: typeof fetch = fetch, input: { apiKey?: string } = {}) {
  return fetchFn(PROVIDER_CONFIG_URL, {
    ...buildRequestInit(input),
  })
    .then((result) => (result.ok ? result.json() : undefined))
    .then((result) => parseAiFactoryModelVisibilityRules(result))
    .catch(() => [] as ModelVisibilityRule[])
}

export function resolveAiFactoryModelVisibility(
  model: { id: string; name: string },
  rules: readonly ModelVisibilityRule[],
) {
  const match = [...rules]
    .reverse()
    .find((rule) => globToRegExp(rule.pattern).test(model.id) || globToRegExp(rule.pattern).test(model.name))
  return match?.visible
}
