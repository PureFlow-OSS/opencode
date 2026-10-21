import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { HttpClient } from "effect/http"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { AppProcess } from "@opencode/util/process"
import { WebSearchMcp } from "../../src/plugin/websearch/mcp.js"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([AppProcess.node, LayerNodePlatform.httpClient])))
const windowsTest = process.platform === "win32" ? it.live : it.live.skip

windowsTest(
  "searches through the real Windows proxy transport with authentication and UTF-8",
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
      const processes = yield* AppProcess.Service
      const http = yield* HttpClient.HttpClient
      const query = "Grüße € ' ; $notAVariable"
      const result = yield* WebSearchMcp.call(
        http,
        "http://search.proxy-check.invalid/mcp",
        "web_search",
        {
          input: Schema.Struct({ query: Schema.String }),
          output: Schema.Struct({ content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })) }),
        },
        { query },
        { Authorization: "Bearer local-search-test" },
        { proxy: proxy.url.toString(), process: processes.run },
      )
      expect(result).toEqual({ content: [{ type: "text", text: "Grüße € – Österreich" }] })
      expect(requests).toEqual([
        {
          authorization: "Bearer local-search-test",
          accept: "application/json, text/event-stream",
          body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "web_search", arguments: { query } } },
        },
      ])
    }),
  30000,
)
