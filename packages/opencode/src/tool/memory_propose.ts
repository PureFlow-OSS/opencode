import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { MemoryProposals } from "@/memory/proposals"

const Parameters = Schema.Struct({
  category: Schema.String.annotate({
    description: "Category: 'style', 'preference', 'correction', 'decision', or 'lesson'",
  }),
  content: Schema.String.annotate({
    description: "The memory content to propose saving",
  }),
  scope: Schema.optional(Schema.String).annotate({
    description: "Scope: 'user' for personal preferences or 'project' for project knowledge. Defaults to 'project'.",
  }),
  reason: Schema.String.annotate({
    description: "Brief explanation of why this is worth remembering across sessions",
  }),
  destination: Schema.optional(Schema.Union(Schema.Literal("sqlite"), Schema.Literal("file"))).annotate({
    description: "Storage destination: 'sqlite' for searchable database (default) or 'file' for .opencode/memory/",
  }),
  filePath: Schema.optional(Schema.String).annotate({
    description:
      "Relative path within .opencode/memory/ when destination is 'file', e.g. 'lessons/2025-01-01-auth-fix.md'",
  }),
  mode: Schema.optional(Schema.Union(Schema.Literal("write"), Schema.Literal("append"))).annotate({
    description:
      "File write mode when destination is 'file': 'write' replaces the file, 'append' adds content at the end (default: 'write'). Use 'append' for entities.md and ongoing lesson files.",
  }),
})

export const MemoryProposeTool = Tool.define<typeof Parameters, {}, MemoryProposals.Service>(
  "memory_propose",
  Effect.gen(function* () {
    const proposals = yield* MemoryProposals.Service

    return {
      hidden: true,
      description:
        "Queue a memory to be proposed for saving at the end of this session. The user reviews all proposals and decides which to keep. Use this when you discover something worth remembering: a correction, preference, architectural decision, or lesson learned.",
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          yield* proposals.add(ctx.sessionID, {
            category: params.category,
            content: params.content,
            scope: params.scope ?? "project",
            reason: params.reason,
            destination: params.destination,
            filePath: params.filePath,
            mode: params.mode,
          })
          return {
            title: "Memory queued",
            output: `Proposal queued for end-of-session review: [${params.scope ?? "project"}/${params.category}] ${params.content}`,
            metadata: {},
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, {}>
  }),
)
