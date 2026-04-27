import * as BashProcess from "./bash-process"
import { BashProcessID } from "./bash-process"
import DESCRIPTION from "./bash_stop.txt"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  process_id: BashProcessID.annotate({ description: "Background process id returned by bash tool" }),
})

export const BashStopTool = Tool.define(
  "bash_stop",
  Effect.gen(function* () {
    const process = yield* BashProcess.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const info = yield* process.stop(params.process_id)
          if (!info) throw new Error(`Background process not found: ${params.process_id}`)
          const output =
            info.status === "running"
              ? `Stop signal sent to background process ${info.id} (pid ${info.pid}).`
              : `Background process ${info.id} already ${info.status}.`
          return {
            title: `Stop process ${info.id}`,
            output,
            metadata: {
              process_id: info.id,
              pid: info.pid,
              status: info.status,
              exit_code: info.exit_code,
              truncated: false,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
