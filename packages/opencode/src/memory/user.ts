import { Effect } from "effect"
import { Database, eq, and, inArray, isNull, or, gt, sql } from "../storage"
import { MemoryTable } from "./memory.sql"

const USER_CATEGORIES = ["style", "preference", "correction"] as const
const TOKEN_APPROX = 4

export const inject = Effect.fn("UserMemory.inject")(function* (_projectID: string, tokenBudget = 500) {
  const now = Date.now()

  // fetch active (non-expired) user memories in the relevant categories
  const rows = yield* Effect.sync(() =>
    Database.use((db) =>
      db
        .select()
        .from(MemoryTable)
        .where(
          and(
            eq(MemoryTable.scope, "user"),
            inArray(MemoryTable.category, [...USER_CATEGORIES]),
            or(isNull(MemoryTable.ttl), gt(MemoryTable.ttl, now)),
          ),
        )
        .all(),
    ),
  )

  if (rows.length === 0) return ""

  // update last_used and increment use_count for retrieved entries
  const ids = rows.map((r) => r.id)
  yield* Effect.sync(() =>
    Database.transaction((db) => {
      for (const id of ids) {
        db.update(MemoryTable)
          .set({
            last_used: now,
            use_count: sql`${MemoryTable.use_count} + 1`,
          } as any)
          .where(eq(MemoryTable.id, id))
          .run()
      }
    }),
  )

  // build bullet list within token budget
  const lines: string[] = []
  let used = 0

  for (const row of rows) {
    const line = `- [${row.category}] ${row.content}`
    const tokens = Math.ceil(line.length / TOKEN_APPROX)
    if (used + tokens > tokenBudget) break
    lines.push(line)
    used += tokens
  }

  if (lines.length === 0) return ""

  return `<user_memory>\n${lines.join("\n")}\n</user_memory>`
})

export * as UserMemory from "./user"
