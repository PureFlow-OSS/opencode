import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { MemoryService } from "@/memory/service"

export const Parameters = Schema.Struct({
  id: Schema.String.annotate({ description: "ID of the memory to delete" }),
})

type Metadata = Record<string, never>

export const MemoryRemoveTool = Tool.define<typeof Parameters, Metadata, MemoryService.Service>(
  "memory_remove",
  Effect.gen(function* () {
    const svc = yield* MemoryService.Service

    return {
      description: "Delete a memory permanently.",
      parameters: Parameters,
      execute: (params, _ctx) =>
        Effect.gen(function* () {
          yield* svc.remove(params.id)
          return {
            title: `Memory removed [${params.id}]`,
            output: `Deleted memory ${params.id}`,
            metadata: {},
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
