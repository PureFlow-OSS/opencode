import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { MemoryService } from "@/memory/service"

export const Parameters = Schema.Struct({
  scope: Schema.String.annotate({
    description: "Scope of the memory: 'user' for personal preferences or 'project' for project-specific knowledge",
  }),
  category: Schema.String.annotate({
    description: "Category: 'style', 'preference', 'correction', 'decision', 'lesson', or custom",
  }),
  content: Schema.String.annotate({ description: "The memory content to save" }),
  source: Schema.optional(Schema.String).annotate({
    description: "Source context (e.g. session ID or tool name). Defaults to 'llm'.",
  }),
  ttl: Schema.optional(Schema.Number).annotate({
    description: "Optional expiry timestamp (milliseconds since epoch). Omit for permanent memories.",
  }),
})

type Metadata = { id: string }

export const MemoryAddTool = Tool.define<typeof Parameters, Metadata, MemoryService.Service>(
  "memory_add",
  Effect.gen(function* () {
    const svc = yield* MemoryService.Service

    return {
      description: "Save a memory for future sessions. Use for style preferences, corrections, architectural decisions, and lessons learned.",
      parameters: Parameters,
      execute: (params, _ctx) =>
        Effect.gen(function* () {
          const entry = yield* svc.add({
            scope: params.scope,
            category: params.category,
            content: params.content,
            source: params.source ?? "llm",
            ttl: params.ttl,
          })
          return {
            title: `Memory saved [${entry.scope}/${entry.category}]`,
            output: `Saved memory ${entry.id}: ${entry.content}`,
            metadata: { id: entry.id },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
