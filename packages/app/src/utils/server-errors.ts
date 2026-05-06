export type ConfigInvalidError = {
  name: "ConfigInvalidError"
  data: {
    path?: string
    message?: string
    issues?: Array<{ message: string; path: string[] }>
  }
}

export type ProviderModelNotFoundError = {
  name: "ProviderModelNotFoundError"
  data: {
    providerID: string
    modelID: string
    suggestions?: string[]
  }
}

type Translator = (key: string, vars?: Record<string, string | number>) => string

function tr(translator: Translator | undefined, key: string, text: string, vars?: Record<string, string | number>) {
  if (!translator) return text
  const out = translator(key, vars)
  if (!out || out === key) return text
  return out
}

export function formatServerError(error: unknown, translate?: Translator, fallback?: string) {
  if (isConfigInvalidErrorLike(error)) return parseReadableConfigInvalidError(error, translate)
  if (isProviderModelNotFoundErrorLike(error)) return parseReadableProviderModelNotFoundError(error, translate)
  const structured = extractStructuredErrorMessage(error)
  if (structured) return structured
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  if (fallback) return fallback
  return tr(translate, "error.chain.unknown", "Unknown error")
}

export function formatUserFacingServerError(error: unknown, translate?: Translator, fallback?: string) {
  if (isConfigInvalidErrorLike(error)) return parseReadableConfigInvalidError(error, translate)
  if (isProviderModelNotFoundErrorLike(error)) return parseReadableProviderModelNotFoundError(error, translate)
  if (typeof error === "string" && error) return error
  if (fallback) return fallback
  return tr(translate, "error.chain.unknown", "Unknown error")
}

export function debugServerError(error: unknown) {
  if (error instanceof Error) {
    const fields = extractKnownFields(error)
    const { message: knownMessage, ...rest } = fields
    return {
      name: error.name,
      message: knownMessage ?? error.message,
      stack: error.stack,
      ...rest,
    }
  }
  if (typeof error === "object" && error !== null) {
    return {
      ...extractKnownFields(error),
      raw: safeJson(error),
    }
  }
  return error
}

function isConfigInvalidErrorLike(error: unknown): error is ConfigInvalidError {
  if (typeof error !== "object" || error === null) return false
  const o = error as Record<string, unknown>
  return o.name === "ConfigInvalidError" && typeof o.data === "object" && o.data !== null
}

function isProviderModelNotFoundErrorLike(error: unknown): error is ProviderModelNotFoundError {
  if (typeof error !== "object" || error === null) return false
  const o = error as Record<string, unknown>
  return o.name === "ProviderModelNotFoundError" && typeof o.data === "object" && o.data !== null
}

export function parseReadableConfigInvalidError(errorInput: ConfigInvalidError, translator?: Translator) {
  const file = errorInput.data.path && errorInput.data.path !== "config" ? errorInput.data.path : "config"
  const detail = errorInput.data.message?.trim() ?? ""
  const issues = (errorInput.data.issues ?? [])
    .map((issue) => {
      const msg = issue.message.trim()
      if (!issue.path.length) return msg
      return `${issue.path.join(".")}: ${msg}`
    })
    .filter(Boolean)
  const msg = issues.length ? issues.join("\n") : detail
  if (!msg) return tr(translator, "error.chain.configInvalid", `Config file at ${file} is invalid`, { path: file })
  return tr(translator, "error.chain.configInvalidWithMessage", `Config file at ${file} is invalid: ${msg}`, {
    path: file,
    message: msg,
  })
}

function parseReadableProviderModelNotFoundError(errorInput: ProviderModelNotFoundError, translator?: Translator) {
  const p = errorInput.data.providerID.trim()
  const m = errorInput.data.modelID.trim()
  const list = (errorInput.data.suggestions ?? []).map((v) => v.trim()).filter(Boolean)
  const body = tr(translator, "error.chain.modelNotFound", `Model not found: ${p}/${m}`, { provider: p, model: m })
  const tail = tr(translator, "error.chain.checkConfig", "Check your config (opencode.json) provider/model names")
  if (list.length) {
    const suggestions = list.slice(0, 5).join(", ")
    return [body, tr(translator, "error.chain.didYouMean", `Did you mean: ${suggestions}`, { suggestions }), tail].join(
      "\n",
    )
  }
  return [body, tail].join("\n")
}

function extractStructuredErrorMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return
  const fields = extractKnownFields(error)
  const parts = [
    typeof fields.message === "string" ? fields.message.trim() : "",
    typeof fields.error === "string" ? fields.error.trim() : "",
    typeof fields.detail === "string" ? fields.detail.trim() : "",
    typeof fields.statusText === "string" ? fields.statusText.trim() : "",
    typeof fields.causeMessage === "string" ? fields.causeMessage.trim() : "",
  ].filter(Boolean)
  if (parts.length > 0) return parts.join("\n")
  if (typeof fields.status === "number") return `HTTP ${fields.status}`
  return
}

function extractKnownFields(error: object) {
  const input = error as Record<string, unknown>
  const response = asRecord(input.response)
  const data = asRecord(input.data)
  const cause = asRecord(input.cause)
  return {
    message: firstString(input.message, data?.message, response?.message),
    error: firstString(input.error, data?.error, response?.error),
    detail: firstString(input.detail, data?.detail, response?.detail),
    statusText: firstString(input.statusText, response?.statusText),
    causeMessage: firstString(cause?.message),
    status: firstNumber(input.status, response?.status),
    code: firstString(input.code, data?.code, response?.code),
  }
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value
  }
  return
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
