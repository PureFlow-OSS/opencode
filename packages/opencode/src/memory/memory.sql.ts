import { sqliteTable, text, integer, real, blob, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const MemoryTable = sqliteTable(
  "memory",
  {
    id: text().primaryKey(),
    scope: text().notNull(),
    category: text().notNull(),
    content: text().notNull(),
    previous: text(),
    source: text().notNull(),
    confidence: real().$default(() => 1.0),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
    last_used: integer(),
    use_count: integer().$default(() => 0),
    ttl: integer(),
    embedding: blob().$type<Buffer>(),
    ...Timestamps,
  },
  (table) => [
    index("memory_scope_idx").on(table.scope),
    index("memory_category_idx").on(table.category),
    index("memory_scope_category_idx").on(table.scope, table.category),
  ],
)
