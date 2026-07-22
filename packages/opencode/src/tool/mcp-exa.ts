import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as Process from "@/util/process"

const URL = process.env.EXA_API_KEY
  ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
  : "https://mcp.exa.ai/mcp"

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
const envProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy

const parseSse = Effect.fn("McpExa.parseSse")(function* (body: string) {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const data = yield* decode(line.substring(6)).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (data?.result.content[0]?.text) return data.result.content[0].text
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

const windowsProxyCall = <F extends Schema.Struct.Fields>(
  tool: string,
  value: Schema.Struct.Type<F>,
  timeout: Duration.Input,
  proxy: string,
) =>
  Effect.fn("McpExa.windowsProxyCall")(function* () {
    const ms = timeoutMs(timeout)
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: value },
    }).replace(/'/g, "''")
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      `$body = '${payload}'`,
      "$headers = @{ Accept = 'application/json, text/event-stream' }",
      "$response = $null",
      "for ($i = 0; $i -lt 2; $i++) { try {",
      `  $response = Invoke-WebRequest -UseBasicParsing -Uri '${URL}' -Method POST -ContentType 'application/json' -Headers $headers -Body $body -Proxy '${proxy}' -ProxyUseDefaultCredentials -TimeoutSec ${Math.max(1, Math.ceil(ms / 1000))}`,
      "  break",
      "} catch {",
      "  if ($i -eq 1) { throw }",
      "  Start-Sleep -Milliseconds 300",
      "} }",
      "$response.Content",
    ].join("; ")
    const result = yield* Effect.promise(() =>
      Process.text(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script]),
    )
    if (!result.text.trim()) throw new Error(`${tool} PowerShell websearch returned no output`)
    return result.text
  })

export const SearchArgs = Schema.Struct({
  query: Schema.String,
  type: Schema.String,
  numResults: Schema.Number,
  livecrawl: Schema.String,
  contextMaxCharacters: Schema.optional(Schema.Number),
})

export const CodeArgs = Schema.Struct({
  query: Schema.String,
  tokensNum: Schema.Number,
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
  tool: string,
  args: Schema.Struct<F>,
  value: Schema.Struct.Type<F>,
  timeout: Duration.Input,
  proxy = envProxy,
) =>
  Effect.gen(function* () {
    const body =
      process.platform === "win32" && proxy
        ? yield* windowsProxyCall(tool, value, timeout, proxy)()
        : yield* Effect.gen(function* () {
            const request = yield* HttpClientRequest.post(URL).pipe(
              HttpClientRequest.accept("application/json, text/event-stream"),
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
    const result = yield* parseSse(body)
    if (result) return result

    const response = body.replace(/\s+/g, " ").trim().slice(0, 1_000)
    yield* Effect.logWarning("web search returned an unrecognized MCP response", { tool, response })
    return yield* Effect.fail(new Error(`${tool} returned an unrecognized MCP response: ${response || "empty body"}`))
  })
