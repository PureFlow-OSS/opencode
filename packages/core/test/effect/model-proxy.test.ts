import { expect, test } from "bun:test"
import { RequestExecutor } from "@opencode/ai/route"
import { HttpProxy } from "@opencode/util/http-proxy"
import { Effect, Option, Stream } from "effect"
import { HttpClientRequest } from "effect/http"
import { AppNodeBuilder } from "../../src/effect/app-node-builder.js"
import { LayerNodePlatform } from "../../src/effect/app-node-platform.js"

const verifyWindows = process.platform === "win32" ? test : test.skip

verifyWindows("model executor retries proxy authentication and streams the original compressed request", async () => {
  const body = Bun.zstdCompressSync(JSON.stringify({ model: "fixture", input: "test", stream: true }))
  const received: Array<{
    body: Uint8Array
    authorization: string | null
    account: string | null
    encoding: string | null
  }> = []
  const release = Promise.withResolvers<void>()
  const state = { cancelled: false }
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      received.push({
        body: new Uint8Array(await request.arrayBuffer()),
        authorization: request.headers.get("authorization"),
        account: request.headers.get("chatgpt-account-id"),
        encoding: request.headers.get("content-encoding"),
      })
      if (received.length === 1) return new Response(null, { status: 407 })
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"ok"}\n\n'))
            void release.promise.then(() => {
              if (!state.cancelled) controller.close()
            })
          },
          cancel() {
            state.cancelled = true
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  HttpProxy.configure({ use_http_proxy: true, http_proxy: proxy.url.href })
  try {
    const chunk = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* RequestExecutor.Service
        const response = yield* executor.execute(
          HttpClientRequest.post("http://openai.invalid/v1/responses").pipe(
            HttpClientRequest.bodyUint8Array(body),
            HttpClientRequest.setHeaders({
              authorization: "Bearer origin-only",
              "chatgpt-account-id": "fixture-account",
              "content-type": "application/json",
              "content-encoding": "zstd",
            }),
          ),
        )
        expect(response.status).toBe(200)
        return yield* Stream.runHead(response.stream)
      }).pipe(Effect.provide(AppNodeBuilder.build(LayerNodePlatform.requestExecutor)), Effect.scoped),
    )
    expect(Option.isSome(chunk)).toBe(true)
    if (Option.isSome(chunk)) expect(new TextDecoder().decode(chunk.value)).toContain('"delta":"ok"')
    expect(received).toHaveLength(2)
    expect(received).toEqual(
      [0, 1].map(() => ({
        body: new Uint8Array(body),
        authorization: "Bearer origin-only",
        account: "fixture-account",
        encoding: "zstd",
      })),
    )
  } finally {
    release.resolve()
    HttpProxy.configure({})
    proxy.stop(true)
  }
})

test("model executor keeps a configured internal AI gateway direct", async () => {
  const seen = { origin: 0, proxy: 0 }
  const origin = Bun.serve({
    hostname: "127.0.0.2",
    port: 0,
    fetch() {
      seen.origin++
      return new Response("direct")
    },
  })
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      seen.proxy++
      return new Response(null, { status: 407 })
    },
  })
  HttpProxy.configure({ use_http_proxy: true, http_proxy: proxy.url.href, aifactory_host: origin.url.href })
  try {
    const text = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* RequestExecutor.Service
        const response = yield* executor.execute(HttpClientRequest.get(origin.url.href))
        return yield* response.text
      }).pipe(Effect.provide(AppNodeBuilder.build(LayerNodePlatform.requestExecutor)), Effect.scoped),
    )
    expect(text).toBe("direct")
    expect(seen).toEqual({ origin: 1, proxy: 0 })
  } finally {
    HttpProxy.configure({})
    origin.stop(true)
    proxy.stop(true)
  }
})

verifyWindows.each([401, 403])("model executor does not retry origin authorization failure %i", async (status) => {
  const seen = { requests: 0 }
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      seen.requests++
      return new Response(null, { status })
    },
  })
  HttpProxy.configure({ use_http_proxy: true, http_proxy: proxy.url.href })
  try {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service
          return yield* executor.execute(HttpClientRequest.get("http://openai.invalid/v1/responses"))
        }).pipe(Effect.provide(AppNodeBuilder.build(LayerNodePlatform.requestExecutor)), Effect.scoped),
      ),
    ).rejects.toThrow(`Provider request failed with HTTP ${status}`)
    expect(seen.requests).toBe(1)
  } finally {
    HttpProxy.configure({})
    proxy.stop(true)
  }
})
