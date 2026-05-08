import { Effect, Context, Layer } from "effect"
import { embed, cosineSimilarity } from "ai"
import { Config } from "@/config"
import { Provider } from "@/provider"
import { ProviderID } from "@/provider/schema"
import { Database, eq, isNotNull } from "../storage"
import { MemoryTable } from "./memory.sql"
import { Log } from "@/util"

const log = Log.create({ service: "memory.embedding" })

function floatsToBuffer(floats: number[]): Buffer {
  const arr = new Float32Array(floats)
  return Buffer.from(arr.buffer)
}

function bufferToFloats(buf: Buffer): number[] {
  const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(arr)
}

export interface Interface {
  readonly generate: (content: string) => Effect.Effect<number[] | undefined>
  readonly store: (memoryID: string, content: string) => Effect.Effect<void>
  readonly search: (query: string, topK?: number) => Effect.Effect<{ id: string; similarity: number }[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MemoryEmbedding") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const provider = yield* Provider.Service

    const getEmbeddingModel = Effect.fn("MemoryEmbedding.getModel")(function* () {
      const cfg = yield* config.get()
      const modelStr = cfg.memory?.embeddingModel
      if (!modelStr) return undefined
      const slash = modelStr.indexOf("/")
      if (slash === -1) return undefined
      const providerID = ProviderID.make(modelStr.slice(0, slash))
      const modelID = modelStr.slice(slash + 1)
      return yield* provider.getEmbeddingModel(providerID, modelID)
    })

    const generate = Effect.fn("MemoryEmbedding.generate")(function* (content: string) {
      const model = yield* getEmbeddingModel()
      if (!model) return undefined
      const result = yield* Effect.promise(() =>
        embed({ model, value: content, maxRetries: 1 }),
      ).pipe(
        Effect.catchAll((e) => {
          log.warn("embedding failed", { error: String(e) })
          return Effect.succeed(undefined)
        }),
      )
      return result?.embedding ? Array.from(result.embedding) : undefined
    })

    const store = Effect.fn("MemoryEmbedding.store")(function* (memoryID: string, content: string) {
      const floats = yield* generate(content)
      if (!floats) return
      const buf = floatsToBuffer(floats)
      yield* Effect.sync(() =>
        Database.transaction((db) => {
          db.update(MemoryTable).set({ embedding: buf }).where(eq(MemoryTable.id, memoryID)).run()
        }),
      )
    })

    const search = Effect.fn("MemoryEmbedding.search")(function* (query: string, topK = 10) {
      const queryFloats = yield* generate(query)
      if (!queryFloats) return []

      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select({ id: MemoryTable.id, embedding: MemoryTable.embedding }).from(MemoryTable).where(isNotNull(MemoryTable.embedding)).all(),
        ),
      )

      return rows
        .flatMap((row) => {
          if (!row.embedding) return []
          const stored = bufferToFloats(row.embedding)
          const similarity = cosineSimilarity(queryFloats, stored)
          return [{ id: row.id, similarity }]
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK)
    })

    return Service.of({ generate, store, search })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(Provider.defaultLayer),
  ),
)

export * as MemoryEmbedding from "./embedding"
