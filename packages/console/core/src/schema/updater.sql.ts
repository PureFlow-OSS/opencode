import { index, int, mediumtext, mysqlEnum, mysqlTable, primaryKey, varchar } from "drizzle-orm/mysql-core"
import { timestamps, ulid, utc } from "../drizzle/types"

export const UpdaterChannel = ["beta", "normal"] as const
export const FeedbackRating = ["positive", "neutral", "negative"] as const

export const UpdaterReleaseTable = mysqlTable(
  "updater_release",
  {
    id: ulid("id"),
    ...timestamps,
    channel: mysqlEnum("channel", UpdaterChannel).notNull(),
    version: varchar("version", { length: 64 }).notNull(),
    zipName: varchar("zip_name", { length: 255 }).notNull(),
    zipSha256: varchar("zip_sha256", { length: 64 }).notNull(),
    zipSize: int("zip_size").notNull(),
    notes: mediumtext("notes"),
    promotedFromReleaseID: ulid("promoted_from_release_id"),
    timePromoted: utc("time_promoted"),
  },
  (table) => [primaryKey({ columns: [table.id] }), index("updater_release_channel_idx").on(table.channel, table.timeCreated)],
)

export const UpdaterFeedbackTable = mysqlTable(
  "updater_feedback",
  {
    id: ulid("id"),
    ...timestamps,
    channel: mysqlEnum("channel", ["beta", "general"]).notNull(),
    releaseID: ulid("release_id"),
    userName: varchar("user_name", { length: 255 }),
    userEmail: varchar("user_email", { length: 255 }),
    rating: mysqlEnum("rating", FeedbackRating).notNull(),
    message: mediumtext("message").notNull(),
  },
  (table) => [primaryKey({ columns: [table.id] }), index("updater_feedback_channel_idx").on(table.channel, table.timeCreated)],
)

export const UpdaterAuditTable = mysqlTable(
  "updater_audit",
  {
    id: ulid("id"),
    ...timestamps,
    feedbackID: ulid("feedback_id").notNull(),
    actor: varchar("actor", { length: 255 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    details: mediumtext("details").notNull(),
  },
  (table) => [primaryKey({ columns: [table.id] }), index("updater_audit_feedback_idx").on(table.feedbackID, table.timeCreated)],
)
