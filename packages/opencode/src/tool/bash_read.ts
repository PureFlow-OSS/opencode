import * as BashProcess from "./bash-process"
import { BashProcessID, StreamName, formatRead } from "./bash-process"
import DESCRIPTION from "./bash_read.txt"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  process_id: BashProcessID.annotate({ description: "Background process id returned by bash tool" }),
  stream: Schema.optional(StreamName).annotate({
    description: `Which stream to read: "stdout", "stderr", or "all". Defaults to "stdout".`,
  }),
  offset: Schema.optional(Schema.Number).annotate({
    description: "The line number to start reading from (1-indexed)",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of lines to read",
  }),
})

export const BashReadTool = Tool.define(
  "bash_read",
  Effect.gen(function* () {
    const process = yield* BashProcess.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const result = yield* process.read({
            id: params.process_id,
            stream: params.stream,
            offset: params.offset,
            limit: params.limit,
          })
          if (!result) throw new Error(`Background process not found: ${params.process_id}`)
          return {
            title: `Read process ${result.info.id}`,
            output: formatRead(result, "process"),
            metadata: {
              process_id: result.info.id,
              pid: result.info.pid,
              status: result.info.status,
              exit_code: result.info.exit_code,
              truncated: false,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
