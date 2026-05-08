import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { MemoryService } from "@/memory/service"

export const Parameters = Schema.Struct({
  id: Schema.String.annotate({ description: "ID of the memory to update" }),
  content: Schema.String.annotate({ description: "New content for the memory" }),
})

type Metadata = { id: string }

export const MemoryUpdateTool = Tool.define<typeof Parameters, Metadata, MemoryService.Service>(
  "memory_update",
  Effect.gen(function* () {
    const svc = yield* MemoryService.Service

    return {
      description: "Update an existing memory. The previous value is preserved.",
      parameters: Parameters,
      execute: (params, _ctx) =>
        Effect.gen(function* () {
          const entry = yield* svc.update(params.id, params.content)
          return {
            title: `Memory updated [${entry.id}]`,
            output: `Updated memory ${entry.id}: ${entry.content}`,
            metadata: { id: entry.id },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
