export * as WebSearchMcp from "./mcp.js"

import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { HttpProxy } from "@opencode/util/http-proxy"
import { collectBoundedResponseBody } from "../../tool/http-body.js"
import { ChildProcess } from "effect/process"
import { AppProcess } from "@opencode/util/process"

export const MAX_RESPONSE_BYTES = 256 * 1024

const windowsProxyScript = [
  "[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false",
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
  "$OutputEncoding = New-Object System.Text.UTF8Encoding $false",
  "$ProgressPreference = 'SilentlyContinue'",
  "$request = [Console]::In.ReadToEnd() | ConvertFrom-Json",
  "$headers = @{}",
  "foreach ($item in $request.headers.PSObject.Properties) { $headers[$item.Name] = [string]$item.Value }",
  "if (-not $headers.ContainsKey('Accept')) { $headers['Accept'] = 'application/json, text/event-stream' }",
  "$response = Invoke-WebRequest -UseBasicParsing -Uri $request.url -Method POST -ContentType 'application/json; charset=utf-8' -Headers $headers -Body ([Convert]::FromBase64String($request.body)) -Proxy $request.proxy -ProxyUseDefaultCredentials -TimeoutSec 25",
  "if ([string]::IsNullOrWhiteSpace([string]$response.Content)) { throw 'MCP returned an empty response' }",
  "[string]$response.Content",
].join("; ")

export const windowsProxyCommand = () =>
  ChildProcess.make(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(windowsProxyScript, "utf16le").toString("base64")],
    { env: HttpProxy.environment(), extendEnv: true },
  )

const windowsProxyPayload = (url: string, proxy: string, headers: Record<string, string>, body: Uint8Array) =>
  JSON.stringify({ url, proxy, headers, body: Buffer.from(body).toString("base64") })

export const windowsProxyRequest = (
  run: AppProcess.Interface["run"],
  url: string,
  proxy: string,
  headers: Record<string, string>,
  body: Uint8Array,
) =>
  Effect.gen(function* () {
    const result = yield* run(windowsProxyCommand(), {
      timeout: Duration.seconds(25),
      maxOutputBytes: MAX_RESPONSE_BYTES,
      stdin: windowsProxyPayload(url, proxy, headers, body),
    })
    if (result.exitCode !== 0) return yield* Effect.fail(new Error("PowerShell proxy request failed"))
    if (result.stdoutTruncated)
      return yield* Effect.fail(new Error(`MCP response exceeded ${MAX_RESPONSE_BYTES} bytes`))
    return result.stdout.toString("utf8")
  })

export const parseResponse = <F extends Schema.Struct.Fields>(body: string, result: Schema.Struct<F>) => {
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ result })))
  const parse = (payload: string) => {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return Effect.undefined
    return decode(trimmed).pipe(Effect.map((response) => response.result))
  }
  return Effect.gen(function* () {
    const trimmed = body.trim()
    const direct = trimmed ? yield* parse(trimmed) : undefined
    if (direct) return direct
    for (const line of body.split("\n")) {
      if (!line.startsWith("data: ")) continue
      const data = yield* parse(line.substring(6))
      if (data) return data
    }
  })
}

export const call = <F extends Schema.Struct.Fields, R extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  url: string,
  tool: string,
  schema: { readonly input: Schema.Struct<F>; readonly output: Schema.Struct<R> },
  value: Schema.Struct.Type<F>,
  headers: Record<string, string> = {},
  options?: {
    readonly proxy?: string
    readonly process?: AppProcess.Interface["run"]
  },
) =>
  Effect.gen(function* () {
    if (process.platform === "win32" && options?.proxy) {
      const request = yield* HttpClientRequest.post(url).pipe(
        HttpClientRequest.schemaBodyJson(
          Schema.Struct({
            jsonrpc: Schema.Literal("2.0"),
            id: Schema.Literal(1),
            method: Schema.Literal("tools/call"),
            params: Schema.Struct({ name: Schema.String, arguments: schema.input }),
          }),
        )({
          jsonrpc: "2.0" as const,
          id: 1 as const,
          method: "tools/call" as const,
          params: { name: tool, arguments: value },
        }),
      )
      if (request.body._tag !== "Uint8Array") return yield* Effect.fail(new Error("Unable to encode MCP request body"))
      if (options.process === undefined)
        return yield* Effect.fail(new Error("A process runner is required for a Windows proxy request"))
      const body = yield* windowsProxyRequest(options.process, url, options.proxy, headers, request.body.body)
      return yield* parseResponse(body, schema.output)
    }
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.schemaBodyJson(
        Schema.Struct({
          jsonrpc: Schema.Literal("2.0"),
          id: Schema.Literal(1),
          method: Schema.Literal("tools/call"),
          params: Schema.Struct({ name: Schema.String, arguments: schema.input }),
        }),
      )({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: value },
      }),
    )
    return yield* Effect.gen(function* () {
      const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http)).execute(request)
      const body = yield* collectBoundedResponseBody(
        response,
        MAX_RESPONSE_BYTES,
        () => new Error(`${tool} response exceeded ${MAX_RESPONSE_BYTES} bytes`),
      )
      return yield* parseResponse(body.toString("utf8"), schema.output)
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: Duration.seconds(25),
        orElse: () => Effect.fail(new Error(`${tool} request timed out`)),
      }),
    )
  })
