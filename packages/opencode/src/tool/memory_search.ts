import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { MemoryService } from "@/memory/service"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Keyword to search for in memory content" }),
  scope: Schema.optional(Schema.String).annotate({
    description: "Filter by scope: 'user' or 'project'. Omit for all scopes.",
  }),
  category: Schema.optional(Schema.String).annotate({
    description: "Filter by category. Omit for all categories.",
  }),
})

type Metadata = { count: number }

export const MemorySearchTool = Tool.define<typeof Parameters, Metadata, MemoryService.Service>(
  "memory_search",
  Effect.gen(function* () {
    const svc = yield* MemoryService.Service

    return {
      description: "Search memories by keyword. Returns relevant memories for the current context.",
      parameters: Parameters,
      execute: (params, _ctx) =>
        Effect.gen(function* () {
          const entries = yield* svc.search(params.query, params.scope, params.category)
          const lines = entries.map((e) => `[${e.id}] [${e.scope}/${e.category}] ${e.content}`)
          return {
            title: `${entries.length} results for "${params.query}"`,
            output: lines.length > 0 ? lines.join("\n") : "No matching memories found.",
            metadata: { count: entries.length },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
