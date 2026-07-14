import { Effect, Schema } from "effect"
import { Session } from "../session/session"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  title: Schema.String.annotate({ description: "The new concise title for the current session" }),
})

export const SessionRenameTool = Tool.define(
  "session_rename",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: "Rename the current session so it is easy to find later.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "session_rename",
            patterns: [params.title],
            always: [params.title],
            metadata: {},
          })
          const title = params.title.trim().slice(0, 50)
          if (!title) return yield* Effect.die("Session title must not be empty")
          yield* session.setTitle({ sessionID: ctx.sessionID, title })
          return {
            title,
            output: `Session renamed to: ${title}`,
            metadata: {},
          }
        }),
    }
  }),
)
