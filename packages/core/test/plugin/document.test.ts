import { describe, expect } from "bun:test"
import { PDFDocument } from "@napi-rs/canvas"
import { Message, Media } from "@opencode/ai/effect"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { AiFactoryPlugin } from "@opencode/core/plugin/provider/aifactory"
import { DocumentTools } from "@opencode/core/tool/plugin/document"
import { Tool } from "@opencode/core/tool"
import { DocumentCache } from "@opencode/core/document/cache"
import { Global } from "@opencode/util/global"
import path from "node:path"
import { Document, Info } from "@opencode/schema/config"
import { Effect, Schema } from "effect"
import { PluginTestLayer } from "./fixture"
import { testEffect } from "../lib/effect"
import { executeTool, toolIdentity } from "../lib/tool"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Info)

function pdf() {
  const document = new PDFDocument()
  const first = document.beginPage(300, 150)
  first.font = "18px Arial"
  first.fillText("Revenue 1200", 20, 60)
  document.endPage()
  const second = document.beginPage(300, 150)
  second.font = "18px Arial"
  second.fillText("Second page", 20, 60)
  document.endPage()
  return new Uint8Array(document.close())
}

const fixture = (nativePdf: boolean, summary: "answer" | "reasoning-length" | "empty" = "answer") =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const requests: {
        model: string
        messages: readonly { content: unknown }[]
        max_tokens?: number
        max_completion_tokens?: number
        authorization: string | null
      }[] = []
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/v1/models")
            return Response.json({ data: [{ id: "primary" }, { id: "vision-worker" }, { id: "ocr-worker" }] })
          if (url.pathname === "/v1/chat/completions") {
            const body = Schema.decodeUnknownSync(
              Schema.Struct({
                model: Schema.String,
                messages: Schema.Array(Schema.Struct({ content: Schema.Unknown })),
                max_tokens: Schema.optional(Schema.Number),
                max_completion_tokens: Schema.optional(Schema.Number),
              }),
            )(await request.json())
            requests.push({ ...body, authorization: request.headers.get("authorization") })
            const text =
              body.model === "ocr-worker"
                ? "Expenses 800"
                : body.model === "vision-worker"
                  ? "A chart on page 2"
                  : summary === "answer"
                    ? "A source-grounded summary"
                    : ""
            const reasoning = body.model === "primary" && summary === "reasoning-length"
            return new Response(
              `data: ${JSON.stringify({ id: "completion", object: "chat.completion.chunk", model: body.model, created: 1, choices: [{ index: 0, delta: { role: "assistant", content: text, ...(reasoning ? { reasoning_content: "Internal reasoning without an answer" } : {}) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "completion", object: "chat.completion.chunk", model: body.model, created: 1, choices: [{ index: 0, delta: {}, finish_reason: reasoning ? "length" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`,
              { headers: { "Content-Type": "text/event-stream" } },
            )
          }
          return Response.json({})
        },
      })
      return { server, requests, nativePdf }
    }),
    ({ server }) => Effect.sync(() => server.stop(true)),
  )

const setup = Effect.fn(function* (input: Effect.Success<ReturnType<typeof fixture>>) {
  const config = yield* Config.Test
  yield* config.setEntries([
    new Document({
      type: "document",
      info: decode({
        updater: input.server.url.origin,
        aifactory_host: input.server.url.origin,
        providers: { aifactory: { settings: { apiKey: "document-test-key" } } },
        aifactory: {
          model_limits: [
            {
              pattern: "primary",
              output: 32000,
              document_vision: true,
              document_vision_native: input.nativePdf,
              document_ocr_native_pdf: true,
              document_vision_model: "vision-worker",
              document_ocr_model: "ocr-worker",
            },
          ],
          model_visibility: [
            { pattern: "vision-worker", visible: false },
            { pattern: "ocr-worker", visible: false },
          ],
        },
      }),
    }),
  ])
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "document-test")
  yield* AiFactoryPlugin.effect(host)
  yield* DocumentTools.Plugin.effect(host)
  const model = Model.Ref.make({
    providerID: Model.Ref.parse("aifactory/primary").providerID,
    id: Model.ID.make("primary"),
  })
  const session = yield* host.session.create({ title: "Document test", model })
  const hooks = yield* PluginHooks.Service
  const tools = yield* Tool.Service
  const run = (name: string, args: Record<string, unknown>) =>
    executeTool(tools, {
      ...toolIdentity,
      sessionID: session.id,
      call: { type: "tool-call", id: `call-${name}`, name, input: args },
    })
  return { host, model, session, hooks, run }
})

const cacheText = Effect.fn(function* (sessionID: Tool.Context["sessionID"], text: string) {
  const global = yield* Global.Service
  const cache = DocumentCache.make(path.join(global.data, "document-cache"))
  const manifest = yield* Effect.promise(() =>
    cache.put(
      sessionID,
      new TextEncoder().encode(text),
      "workbook.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
  )
  return yield* Effect.promise(() => cache.update(sessionID, manifest, { pages: [{ page: 1, text }] }))
})

describe("document tools", () => {
  for (const mode of ["reasoning-length", "empty"] as const) {
    it.effect(`distinguishes ${mode} summary responses without retrying or exposing reasoning`, () =>
      Effect.gen(function* () {
        const input = yield* fixture(false, mode)
        const context = yield* setup(input)
        yield* cacheText(context.session.id, "## Sheet 1\nWork package 1")
        const result = yield* context.run("document_summary", {})
        expect(result.status).toBe("error")
        const output = JSON.stringify(result.error)
        expect(output).toContain(mode === "reasoning-length" ? "output token budget was exhausted" : "returned no text")
        expect(output).not.toContain("Internal reasoning without an answer")
        expect(input.requests).toHaveLength(1)
        expect(input.requests[0].max_tokens ?? input.requests[0].max_completion_tokens).toBe(32000)
      }),
    )
  }

  it.effect("leaves summary output to the provider when the model has no configured limit", () =>
    Effect.gen(function* () {
      const input = yield* fixture(false)
      const context = yield* setup(input)
      const models = yield* Model.Service
      yield* models.transform((editor) =>
        editor.update(context.model.providerID, context.model.id, (model) => {
          model.limit.output = 0
        }),
      )
      yield* cacheText(context.session.id, "## Sheet 1\nWork package 1")
      const result = yield* context.run("document_summary", {})
      expect(result.status).toBe("completed")
      expect(input.requests).toHaveLength(1)
      expect(input.requests[0].max_tokens).toBeUndefined()
      expect(input.requests[0].max_completion_tokens).toBeUndefined()
    }),
  )

  it.effect("summarizes all cached workbook text beyond the attachment preview and respects the model limit", () =>
    Effect.gen(function* () {
      const input = yield* fixture(false)
      const context = yield* setup(input)
      const models = yield* Model.Service
      yield* models.transform((editor) =>
        editor.update(context.model.providerID, context.model.id, (model) => {
          model.limit.output = 4096
        }),
      )
      const text = `## First sheet\n${"Cell value\n".repeat(5200)}\n## Last sheet\nFINAL_WORKBOOK_ROW_17`
      yield* cacheText(context.session.id, text)
      const result = yield* context.run("document_summary", {})
      expect(result.status).toBe("completed")
      expect(input.requests).toHaveLength(6)
      expect(JSON.stringify(input.requests)).toContain("FINAL_WORKBOOK_ROW_17")
      expect(input.requests.map((request) => request.max_tokens ?? request.max_completion_tokens)).toEqual([
        4096, 4096, 4096, 4096, 4096, 4096,
      ])
    }),
  )

  it.effect("indexes PDFs, recalls pages through hidden workers, and retains OCR for follow-up search", () =>
    Effect.gen(function* () {
      const input = yield* fixture(false)
      const context = yield* setup(input)
      const event = yield* context.hooks.trigger("session", "context", {
        sessionID: context.session.id,
        model: context.model,
        agent: Agent.defaultID,
        system: [],
        options: {},
        tools: {},
        messages: [
          Message.make({
            role: "user",
            content: [
              Message.text("Review the document"),
              { type: "media", media: Media.bytes(pdf(), "application/pdf"), filename: "report.pdf" },
            ],
          }),
        ],
      })
      expect(event.messages[0].content.every((part) => part.type !== "media")).toBe(true)
      expect(JSON.stringify(event.messages)).toContain("Revenue 1200")
      expect(input.requests).toHaveLength(0)
      const models = yield* Model.Service
      expect((yield* models.available()).map((model) => model.id)).not.toContain(Model.ID.make("vision-worker"))
      expect((yield* models.available()).map((model) => model.id)).not.toContain(Model.ID.make("ocr-worker"))

      const search = yield* context.run("document_search", { query: "Revenue" })
      expect(search.status).toBe("completed")
      expect(JSON.stringify(search.content)).toContain("Revenue 1200")
      const recall = yield* context.run("vision_recall", { pages: [2], question: "Describe the chart" })
      expect(recall.status).toBe("completed")
      expect(JSON.stringify(recall.content)).toContain("A chart on page 2")
      expect(input.requests[0].model).toBe("vision-worker")
      expect(input.requests[0].authorization).toBe("Bearer document-test-key")
      expect(JSON.stringify(input.requests[0].messages)).toContain("image_url")
      expect(JSON.stringify(input.requests[0].messages)).not.toContain("application/pdf")

      const ocr = yield* context.run("document_ocr", { pages: [2] })
      expect(ocr.status).toBe("completed")
      expect(input.requests.at(-1)?.model).toBe("ocr-worker")
      const following = yield* context.run("document_search", { query: "Expenses", pages: [2] })
      expect(JSON.stringify(following.content)).toContain("Expenses 800")
      expect(JSON.stringify(following.content)).toContain("page 2")
      const whole = yield* context.run("document_ocr", {})
      expect(whole.status).toBe("completed")
      expect(JSON.stringify(input.requests.at(-1)?.messages)).toContain("application/pdf")
      const summary = yield* context.run("document_summary", {})
      expect(summary.status).toBe("completed")
      expect(input.requests.at(-1)?.model).toBe("primary")
      expect(JSON.stringify(input.requests.at(-1)?.messages)).toContain("Expenses 800")

      const global = yield* Global.Service
      const persisted = yield* Effect.promise(() =>
        DocumentCache.make(path.join(global.data, "document-cache")).list(context.session.id),
      )
      expect(persisted).toHaveLength(1)
      expect(persisted[0].pages?.find((page) => page.page === 2)?.text).toBe("Expenses 800")
      expect(persisted[0].transcript).toBe("Expenses 800")

      const other = yield* context.host.session.create({ title: "Other session", model: context.model })
      const registry = yield* Tool.Service
      const isolated = yield* executeTool(registry, {
        ...toolIdentity,
        sessionID: other.id,
        call: { type: "tool-call", id: "other-search", name: "document_search", input: {} },
      })
      expect(isolated.status).toBe("error")
    }),
  )

  it.effect(
    "preserves native PDF input only when centrally enabled and replaces malformed fallback input with an error",
    () =>
      Effect.gen(function* () {
        const input = yield* fixture(true)
        const context = yield* setup(input)
        const event = yield* context.hooks.trigger("session", "context", {
          sessionID: context.session.id,
          model: context.model,
          agent: Agent.defaultID,
          system: [],
          options: {},
          tools: {},
          messages: [
            Message.make({
              role: "user",
              content: [{ type: "media", media: Media.bytes(pdf(), "application/pdf"), filename: "native.pdf" }],
            }),
          ],
        })
        expect(event.messages[0].content.some((part) => part.type === "media")).toBe(true)
        const models = yield* Model.Service
        yield* models.transform((editor) =>
          editor.update(context.model.providerID, context.model.id, (model) => {
            model.settings = {
              ...model.settings,
              opencodeDocument: { vision: false, nativePdf: false, nativeImage: false, ocrNativePdf: false },
            }
          }),
        )
        const read = yield* context.hooks.trigger("session", "context", {
          sessionID: context.session.id,
          model: context.model,
          agent: Agent.defaultID,
          system: [],
          options: {},
          tools: {},
          messages: [
            Message.tool({
              id: "read-result",
              name: "read",
              resultType: "content",
              result: [
                {
                  type: "file",
                  mime: "application/pdf",
                  name: "read.pdf",
                  uri: `data:application/pdf;base64,${Buffer.from(pdf()).toString("base64")}`,
                },
              ],
            }),
          ],
        })
        expect(JSON.stringify(read.messages)).toContain("Revenue 1200")
        expect(JSON.stringify(read.messages)).not.toContain('"mime":"application/pdf"')
        const invalid = yield* context.hooks.trigger("session", "context", {
          sessionID: context.session.id,
          model: context.model,
          agent: Agent.defaultID,
          system: [],
          options: {},
          tools: {},
          messages: [
            Message.make({
              role: "user",
              content: [
                {
                  type: "media",
                  media: Media.bytes(new TextEncoder().encode("invalid"), "application/pdf"),
                  filename: "broken.pdf",
                },
              ],
            }),
          ],
        })
        expect(invalid.messages[0].content.every((part) => part.type !== "media")).toBe(true)
        expect(JSON.stringify(invalid.messages)).toContain("Document processing failed")
      }),
  )
})
