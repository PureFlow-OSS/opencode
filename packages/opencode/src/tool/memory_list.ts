import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { MemoryService } from "@/memory/service"

export const Parameters = Schema.Struct({
  scope: Schema.optional(Schema.String).annotate({
    description: "Filter by scope: 'user' or 'project'. Omit for all scopes.",
  }),
  category: Schema.optional(Schema.String).annotate({
    description: "Filter by category (e.g. 'style', 'preference'). Omit for all categories.",
  }),
})

type Metadata = { count: number }

export const MemoryListTool = Tool.define<typeof Parameters, Metadata, MemoryService.Service>(
  "memory_list",
  Effect.gen(function* () {
    const svc = yield* MemoryService.Service

    return {
      description: "List saved memories, optionally filtered by scope or category.",
      parameters: Parameters,
      execute: (params, _ctx) =>
        Effect.gen(function* () {
          const entries = yield* svc.list(params.scope, params.category)
          const lines = entries.map((e) => `[${e.id}] [${e.scope}/${e.category}] ${e.content}`)
          return {
            title: `${entries.length} memories`,
            output: lines.length > 0 ? lines.join("\n") : "No memories found.",
            metadata: { count: entries.length },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
