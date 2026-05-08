import { Context, Effect, Layer, Schema } from "effect"
import { Database, eq, and, like, isNull, or, gt, inArray } from "../storage"
import { MemoryTable } from "./memory.sql"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { MemoryEmbedding } from "./embedding"

export const Entry = Schema.Struct({
  id: Schema.String,
  scope: Schema.String,
  category: Schema.String,
  content: Schema.String,
  previous: Schema.optional(Schema.String),
  source: Schema.String,
  confidence: Schema.optional(Schema.Number),
  created_at: Schema.Number,
  last_used: Schema.optional(Schema.Number),
  use_count: Schema.optional(Schema.Number),
  ttl: Schema.optional(Schema.Number),
  time_created: Schema.Number,
  time_updated: Schema.Number,
})
  .annotate({ identifier: "MemoryEntry" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Entry = Schema.Schema.Type<typeof Entry>

export const AddInput = Schema.Struct({
  scope: Schema.String,
  category: Schema.String,
  content: Schema.String,
  source: Schema.String,
  confidence: Schema.optional(Schema.Number),
  ttl: Schema.optional(Schema.Number),
})
  .annotate({ identifier: "MemoryAddInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type AddInput = Schema.Schema.Type<typeof AddInput>

export interface Interface {
  readonly add: (input: AddInput) => Effect.Effect<Entry>
  readonly update: (id: string, content: string) => Effect.Effect<Entry>
  readonly remove: (id: string) => Effect.Effect<void>
  readonly list: (scope?: string, category?: string) => Effect.Effect<Entry[]>
  readonly search: (query: string, scope?: string, category?: string) => Effect.Effect<Entry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const embedding = yield* MemoryEmbedding.Service
    const now = () => Date.now()

    const add = Effect.fn("Memory.add")(function* (input: AddInput) {
      const id = crypto.randomUUID()
      const ts = now()
      const row = {
        id,
        scope: input.scope,
        category: input.category,
        content: input.content,
        source: input.source,
        confidence: input.confidence ?? 1.0,
        created_at: ts,
        last_used: null as number | null,
        use_count: 0,
        ttl: input.ttl ?? null,
        time_created: ts,
        time_updated: ts,
      }
      yield* Effect.sync(() =>
        Database.transaction((db) => {
          db.insert(MemoryTable).values(row as any).run()
        }),
      )
      yield* Effect.fork(embedding.store(id, input.content))
      return row as Entry
    })

    const update = Effect.fn("Memory.update")(function* (id: string, content: string) {
      const existing = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(MemoryTable).where(eq(MemoryTable.id, id)).get()),
      )
      if (!existing) throw new Error(`Memory not found: ${id}`)

      const ts = now()
      yield* Effect.sync(() =>
        Database.transaction((db) => {
          db.update(MemoryTable)
            .set({
              content,
              previous: existing.content,
              time_updated: ts,
            })
            .where(eq(MemoryTable.id, id))
            .run()
        }),
      )
      yield* Effect.fork(embedding.store(id, content))
      return {
        ...existing,
        content,
        previous: existing.content,
        time_updated: ts,
      } as Entry
    })

    const remove = Effect.fn("Memory.remove")(function* (id: string) {
      yield* Effect.sync(() =>
        Database.transaction((db) => {
          db.delete(MemoryTable).where(eq(MemoryTable.id, id)).run()
        }),
      )
    })

    const list = Effect.fn("Memory.list")(function* (scope?: string, category?: string) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => {
          const conditions = []
          if (scope) conditions.push(eq(MemoryTable.scope, scope))
          if (category) conditions.push(eq(MemoryTable.category, category))
          return conditions.length > 0
            ? db
                .select()
                .from(MemoryTable)
                .where(and(...conditions))
                .all()
            : db.select().from(MemoryTable).all()
        }),
      )
      return rows as Entry[]
    })

    const search = Effect.fn("Memory.search")(function* (query: string, scope?: string, category?: string) {
      const vectorHits = yield* embedding.search(query).pipe(Effect.catchAll(() => Effect.succeed([])))

      const keywordRows = yield* Effect.sync(() =>
        Database.use((db) => {
          const conditions = [like(MemoryTable.content, `%${query}%`)]
          if (scope) conditions.push(eq(MemoryTable.scope, scope))
          if (category) conditions.push(eq(MemoryTable.category, category))
          return db
            .select()
            .from(MemoryTable)
            .where(and(...conditions))
            .all()
        }),
      )

      if (vectorHits.length === 0) return keywordRows as Entry[]

      const vectorIDs = vectorHits.map((h) => h.id)
      const vectorRows = yield* Effect.sync(() =>
        Database.use((db) => {
          const base = db.select().from(MemoryTable).where(inArray(MemoryTable.id, vectorIDs))
          return base.all()
        }),
      )

      const seen = new Set<string>()
      const merged: Entry[] = []
      for (const row of [...vectorRows, ...keywordRows]) {
        if (seen.has(row.id)) continue
        if (scope && row.scope !== scope) continue
        if (category && row.category !== category) continue
        seen.add(row.id)
        merged.push(row as Entry)
      }
      return merged
    })

    return Service.of({ add, update, remove, list, search })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(Layer.provide(MemoryEmbedding.defaultLayer)),
)

export * as MemoryService from "./service"
