import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as Process from "@/util/process"

export const EXA_URL = process.env.EXA_API_KEY
  ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
  : "https://mcp.exa.ai/mcp"
export const PARALLEL_URL = "https://search.parallel.ai/mcp"

const McpResult = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.String,
      }),
    ),
  }),
})

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(McpResult))
const parsePayload = (payload: string) =>
  Effect.gen(function* () {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return undefined
    const data = yield* decode(trimmed).pipe(Effect.catch(() => Effect.succeed(undefined)))
    return data?.result.content.find((item) => item.text)?.text
  })

export const parseResponse = Effect.fn("McpWebSearch.parseResponse")(function* (body: string) {
  const trimmed = body.trim()
  const direct = trimmed ? yield* parsePayload(trimmed) : undefined
  if (direct) return direct

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const data = yield* parsePayload(line.substring(6))
    if (data) return data
  }
  return undefined
})

function timeoutMs(timeout: Duration.Input) {
  if (typeof timeout === "number") return timeout
  const value = String(timeout).trim()
  if (!value) return 25_000
  if (value.includes("second")) return Number.parseFloat(value) * 1000
  if (value.includes("minute")) return Number.parseFloat(value) * 60_000
  return Number.parseFloat(value)
}

function describeSpawnError(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  if (!error || typeof error !== "object") return String(error)
  const detail = error as Error & { code?: unknown; errno?: unknown; syscall?: unknown; path?: unknown; spawnargs?: unknown }
  return [
    error.message,
    typeof detail.code === "string" ? `code=${detail.code}` : undefined,
    typeof detail.errno === "string" || typeof detail.errno === "number" ? `errno=${detail.errno}` : undefined,
    typeof detail.syscall === "string" ? `syscall=${detail.syscall}` : undefined,
    typeof detail.path === "string" ? `path=${detail.path}` : undefined,
    Array.isArray(detail.spawnargs) ? `args=${detail.spawnargs.join(" ")}` : undefined,
  ]
    .filter(Boolean)
    .join("; ")
}

const windowsProxyCall = <F extends Schema.Struct.Fields>(
  url: string,
  tool: string,
  value: Schema.Struct.Type<F>,
  timeout: Duration.Input,
  proxy: string,
) =>
  Effect.fn("McpExa.windowsProxyCall")(function* () {
    const ms = timeoutMs(timeout)
    const payload = Buffer.from(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: value },
      }),
    ).toString("base64")
    const script = [
      "$ProgressPreference = 'SilentlyContinue'",
      `$body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))`,
      "$headers = @{ Accept = 'application/json, text/event-stream' }",
      `$response = Invoke-WebRequest -UseBasicParsing -Uri '${url}' -Method POST -ContentType 'application/json; charset=utf-8' -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body)) -Proxy '${proxy}' -ProxyUseDefaultCredentials -TimeoutSec ${Math.max(1, Math.ceil(ms / 1000))}`,
      "$content = [string]$response.Content",
      "if ([string]::IsNullOrWhiteSpace($content)) { throw \"Parallel MCP returned an empty response (status=$($response.StatusCode); contentType=$($response.Headers['Content-Type']); contentLength=$($response.Headers['Content-Length']))\" }",
      "$content",
    ].join("; ")
    const result = yield* Effect.promise(() =>
      Process.text(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script]),
    ).pipe(
      Effect.catch((error) => {
        const detail = describeSpawnError(error)
        return Effect.gen(function* () {
          yield* Effect.logError("Parallel web search PowerShell proxy request failed", {
            tool,
            proxy: new URL(proxy).origin,
            detail,
          })
          return yield* Effect.fail(new Error(detail))
        })
      }),
    )
    return result.text
  })

export const SearchArgs = Schema.Struct({
  query: Schema.String,
  type: Schema.String,
  numResults: Schema.Number,
  livecrawl: Schema.String,
  contextMaxCharacters: Schema.optional(Schema.Number),
})

export const ParallelSearchArgs = Schema.Struct({
  objective: Schema.String,
  search_queries: Schema.Array(Schema.String),
  session_id: Schema.optional(Schema.String),
  model_name: Schema.optional(Schema.String),
})

const McpRequest = <F extends Schema.Struct.Fields>(args: Schema.Struct<F>) =>
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Literal(1),
    method: Schema.Literal("tools/call"),
    params: Schema.Struct({
      name: Schema.String,
      arguments: args,
    }),
  })

export const call = <F extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  url: string,
  tool: string,
  args: Schema.Struct<F>,
  value: Schema.Struct.Type<F>,
  timeout: Duration.Input,
  headers?: Record<string, string>,
  proxy?: string,
) =>
  Effect.gen(function* () {
    const body =
      process.platform === "win32" && proxy
        ? yield* windowsProxyCall(url, tool, value, timeout, proxy)()
        : yield* Effect.gen(function* () {
            const request = yield* HttpClientRequest.post(url).pipe(
              HttpClientRequest.accept("application/json, text/event-stream"),
              HttpClientRequest.setHeaders(headers ?? {}),
              HttpClientRequest.schemaBodyJson(McpRequest(args))({
                jsonrpc: "2.0" as const,
                id: 1 as const,
                method: "tools/call" as const,
                params: { name: tool, arguments: value },
              }),
            )
            const response = yield* HttpClient.filterStatusOk(http)
              .execute(request)
              .pipe(
                Effect.timeoutOrElse({
                  duration: timeout,
                  orElse: () => Effect.die(new Error(`${tool} request timed out`)),
                }),
              )
            return yield* response.text
          })
    const result = yield* parseResponse(body)
    if (result) return result

    const response = body.replace(/\s+/g, " ").trim().slice(0, 1_000)
    yield* Effect.logWarning("Parallel web search returned an unrecognized MCP response", { tool, response })
    return yield* Effect.fail(new Error(`${tool} returned an unrecognized MCP response: ${response || "empty body"}`))
  })
