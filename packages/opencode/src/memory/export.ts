import { Database, eq } from "../storage"
import { MemoryTable } from "./memory.sql"
import type { AddInput, Entry } from "./service"

export type ExportEntry = Omit<Entry, "id" | "time_created" | "time_updated" | "last_used" | "use_count">

export function exportEntries(scope?: string): ExportEntry[] {
  const rows = Database.use((db) => {
    if (scope) return db.select().from(MemoryTable).where(eq(MemoryTable.scope, scope)).all()
    return db.select().from(MemoryTable).all()
  })
  return rows.map(({ id: _id, time_created: _tc, time_updated: _tu, last_used: _lu, use_count: _uc, ...rest }) => rest)
}

export function importEntries(entries: ExportEntry[]): number {
  const now = Date.now()
  Database.transaction((db) => {
    for (const entry of entries) {
      const row = {
        id: crypto.randomUUID(),
        scope: entry.scope,
        category: entry.category,
        content: entry.content,
        previous: entry.previous ?? null,
        source: entry.source,
        confidence: entry.confidence ?? 1.0,
        created_at: entry.created_at ?? now,
        last_used: null as number | null,
        use_count: 0,
        ttl: entry.ttl ?? null,
        time_created: now,
        time_updated: now,
      }
      db.insert(MemoryTable).values(row as any).run()
    }
  })
  return entries.length
}

export * as MemoryExport from "./export"
