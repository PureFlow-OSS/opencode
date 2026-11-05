import { afterEach, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/http"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { HttpProxy } from "@opencode/util/http-proxy"
import { WebSearchMcp } from "../../src/plugin/websearch/mcp.js"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([LayerNodePlatform.httpClient])))
const windowsTest = process.platform === "win32" ? it.live : it.live.skip
afterEach(() => HttpProxy.configure({}))
;[false, true].forEach((challenge) =>
  windowsTest(
    `searches through the shared Windows HTTP client with UTF-8${challenge ? " after HTTP 407" : ""}`,
    () =>
      Effect.gen(function* () {
        const requests: { authorization: string | null; accept: string | null; body: unknown }[] = []
        const proxy = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              async fetch(request) {
                requests.push({
                  authorization: request.headers.get("authorization"),
                  accept: request.headers.get("accept"),
                  body: await request.json(),
                })
                if (challenge && requests.length === 1)
                  return new Response("Proxy authentication required", { status: 407 })
                return new Response(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    result: { content: [{ type: "text", text: "Grüße € – Österreich" }] },
                  }),
                  { headers: { "content-type": "application/json; charset=utf-8" } },
                )
              },
            }),
          ),
          (server) => Effect.sync(() => server.stop(true)),
        )
        HttpProxy.configure({ use_http_proxy: true, http_proxy: proxy.url.toString() })
        const http = yield* HttpClient.HttpClient
        const query = "Grüße € ' ; $notAVariable"
        const result = yield* WebSearchMcp.call(
          http,
          "http://search.proxy-check.invalid/mcp",
          "web_search",
          {
            input: Schema.Struct({ query: Schema.String }),
            output: Schema.Struct({
              content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })),
            }),
          },
          { query },
          { Authorization: "Bearer local-search-test" },
        )
        expect(result).toEqual({ content: [{ type: "text", text: "Grüße € – Österreich" }] })
        expect(requests).toEqual(
          Array.from({ length: challenge ? 2 : 1 }, () => ({
            authorization: "Bearer local-search-test",
            accept: "application/json, text/event-stream",
            body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "web_search", arguments: { query } } },
          })),
        )
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
    30000,
  ),
)

it.live("preserves HTTP status failures instead of hiding them behind a PowerShell error", () =>
  Effect.gen(function* () {
    const proxy = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("Rate limited", { status: 429 }) }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    HttpProxy.configure({ use_http_proxy: true, http_proxy: proxy.url.toString() })
    const http = yield* HttpClient.HttpClient
    const error = yield* WebSearchMcp.call(
      http,
      "http://search.proxy-check.invalid/mcp",
      "web_search_exa",
      {
        input: Schema.Struct({ query: Schema.String }),
        output: Schema.Struct({ content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })) }),
      },
      { query: "test" },
    ).pipe(Effect.flip)
    expect(HttpClientError.isHttpClientError(error)).toBe(true)
    if (HttpClientError.isHttpClientError(error)) expect(error.response?.status).toBe(429)
  }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
)
