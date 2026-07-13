import { FSUtil } from "@opencode-ai/core/fs-util"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { ToolID } from "./schema"
import { TRUNCATION_DIR } from "./truncation-dir"
import { spawn as spawnProcess, stop as stopProcess, type Child } from "../util/process"
import { Context, Effect, Layer, Schema, Types } from "effect"
import { createReadStream, createWriteStream, type WriteStream } from "node:fs"
import path from "path"
import { createInterface } from "readline"
import { statics } from "@opencode-ai/core/schema"
const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
const MAX_BYTES = 50 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`

export type BashProcessID = ToolID

export const BashProcessID = ToolID
export const StreamName = Schema.Literals(["stdout", "stderr", "all"]).pipe(statics((schema) => ({ zod: schema })))

export const Info = Schema.Struct({
  id: BashProcessID,
  pid: Schema.Number,
  command: Schema.String,
  cwd: Schema.String,
  status: Schema.Literals(["running", "exited", "stopped"]),
  started_at: Schema.Number,
  finished_at: Schema.optional(Schema.Number),
  exit_code: Schema.optional(Schema.Number),
  stdout_path: Schema.String,
  stderr_path: Schema.String,
}).pipe(statics((schema) => ({ zod: schema })))

export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

type Active = {
  info: Info
  child: Child
  stdout: WriteStream
  stderr: WriteStream
  stop_requested: boolean
}

type State = {
  processes: Map<BashProcessID, Active>
}

const finishStream = (stream: WriteStream) =>
  new Promise<void>((resolve) => {
    stream.end(() => resolve())
    stream.on("error", () => resolve())
  })

const command = (shell: string, text: string) => {
  if (process.platform === "win32" && /(?:^|[\\/])(pwsh|powershell)(?:\.exe)?$/i.test(shell)) {
    return [shell, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", text]
  }

  return [text]
}

const pipe = (stream: NodeJS.ReadableStream | null, sink: WriteStream) =>
  new Promise<void>((resolve) => {
    if (!stream) return resolve()
    stream.on("data", (chunk) => sink.write(chunk))
    stream.on("end", () => resolve())
    stream.on("close", () => resolve())
    stream.on("error", () => resolve())
  })

async function lines(filepath: string, opts: { limit: number; offset: number }) {
  const stream = createReadStream(filepath, { encoding: "utf8" })
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  })

  const start = opts.offset - 1
  const raw: string[] = []
  let bytes = 0
  let count = 0
  let cut = false
  let more = false
  try {
    for await (const text of rl) {
      count += 1
      if (count <= start) continue
      if (raw.length >= opts.limit) {
        more = true
        continue
      }

      const line = text.length > MAX_LINE_LENGTH ? `${text.substring(0, MAX_LINE_LENGTH)}${MAX_LINE_SUFFIX}` : text
      const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
      if (bytes + size > MAX_BYTES) {
        cut = true
        more = true
        break
      }

      raw.push(line)
      bytes += size
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  return { raw, count, cut, more, offset: opts.offset }
}

export interface ReadResult {
  info: Info
  stream: Schema.Schema.Type<typeof StreamName>
  stdout?: Awaited<ReturnType<typeof lines>>
  stderr?: Awaited<ReturnType<typeof lines>>
}

export interface Interface {
  readonly start: (input: {
    shell: string
    command: string
    cwd: string
    env: NodeJS.ProcessEnv
  }) => Effect.Effect<Info>
  readonly get: (id: BashProcessID) => Effect.Effect<Info | undefined>
  readonly read: (input: {
    id: BashProcessID
    stream?: Schema.Schema.Type<typeof StreamName>
    offset?: number
    limit?: number
  }) => Effect.Effect<ReadResult | undefined>
  readonly stop: (id: BashProcessID) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BashProcess") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const state = yield* InstanceState.make<State>(() =>
      Effect.gen(function* () {
        const processes = new Map<BashProcessID, Active>()
        yield* Effect.addFinalizer(() =>
          Effect.promise(() =>
            Promise.all(Array.from(processes.values()).map((proc) => stopProcess(proc.child))).then(() => undefined),
          ),
        )
        return { processes }
      }),
    )

    const getActive = Effect.fn("BashProcess.getActive")(function* (id: BashProcessID) {
      const s = yield* InstanceState.get(state)
      return s.processes.get(id)
    })

    const get = Effect.fn("BashProcess.get")(function* (id: BashProcessID) {
      return (yield* getActive(id))?.info
    })

    const start = Effect.fn("BashProcess.start")(function* (input: {
      shell: string
      command: string
      cwd: string
      env: NodeJS.ProcessEnv
    }) {
      const s = yield* InstanceState.get(state)
      yield* fs.ensureDir(TRUNCATION_DIR).pipe(Effect.orDie)

      const id = ToolID.ascending()
      const stdout_path = path.join(TRUNCATION_DIR, `${ToolID.ascending()}-stdout.log`)
      const stderr_path = path.join(TRUNCATION_DIR, `${ToolID.ascending()}-stderr.log`)
      yield* Effect.all([fs.writeFileString(stdout_path, ""), fs.writeFileString(stderr_path, "")]).pipe(Effect.orDie)

      const child = spawnProcess(command(input.shell, input.command), {
        cwd: input.cwd,
        env: input.env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        shell:
          process.platform === "win32" && /(?:^|[\\/])(pwsh|powershell)(?:\.exe)?$/i.test(input.shell)
            ? false
            : input.shell,
      })
      const info: Info = {
        id,
        pid: child.pid ?? -1,
        command: input.command,
        cwd: input.cwd,
        status: "running",
        started_at: Date.now(),
        stdout_path,
        stderr_path,
      }
      const active: Active = {
        info,
        child,
        stdout: createWriteStream(stdout_path, { flags: "a" }),
        stderr: createWriteStream(stderr_path, { flags: "a" }),
        stop_requested: false,
      }
      s.processes.set(id, active)

      void Promise.all([
        pipe(child.stdout, active.stdout),
        pipe(child.stderr, active.stderr),
        child.exited
          .then((code) => {
            active.info.finished_at = Date.now()
            active.info.exit_code = code
            active.info.status = active.stop_requested ? "stopped" : "exited"
          })
          .catch(() => {
            active.info.finished_at = Date.now()
            active.info.status = "stopped"
          }),
      ])
        .finally(() => Promise.all([finishStream(active.stdout), finishStream(active.stderr)]))
        .catch(() => undefined)

      return info
    })

    const read = Effect.fn("BashProcess.read")(function* (input: {
      id: BashProcessID
      stream?: Schema.Schema.Type<typeof StreamName>
      offset?: number
      limit?: number
    }) {
      const proc = yield* getActive(input.id)
      if (!proc) return

      const stream = input.stream ?? "stdout"
      const offset = input.offset ?? 1
      const limit = input.limit ?? DEFAULT_READ_LIMIT
      if (offset < 1) throw new Error("offset must be greater than or equal to 1")

      if (stream === "stdout") {
        return {
          info: proc.info,
          stream,
          stdout: yield* Effect.promise(() => lines(proc.info.stdout_path, { offset, limit })),
        }
      }
      if (stream === "stderr") {
        return {
          info: proc.info,
          stream,
          stderr: yield* Effect.promise(() => lines(proc.info.stderr_path, { offset, limit })),
        }
      }

      return {
        info: proc.info,
        stream,
        stdout: yield* Effect.promise(() => lines(proc.info.stdout_path, { offset, limit })),
        stderr: yield* Effect.promise(() => lines(proc.info.stderr_path, { offset, limit })),
      }
    })

    const stop = Effect.fn("BashProcess.stop")(function* (id: BashProcessID) {
      const proc = yield* getActive(id)
      if (!proc) return
      if (proc.info.status !== "running") return proc.info
      proc.stop_requested = true
      yield* Effect.promise(() => stopProcess(proc.child))
      return proc.info
    })

    return Service.of({ start, get, read, stop })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [FSUtil.node],
})

export const formatRead = (result: Awaited<ReadResult>, label = "process") => {
  const parts = [
    `<${label}_id>${result.info.id}</${label}_id>`,
    `<pid>${result.info.pid}</pid>`,
    `<status>${result.info.status}</status>`,
    `<cwd>${result.info.cwd}</cwd>`,
    `<command>${result.info.command}</command>`,
  ]

  const render = (name: "stdout" | "stderr", file: Awaited<ReturnType<typeof lines>> | undefined, filepath: string) => {
    if (!file) return []
    const last = file.offset + file.raw.length - 1
    const next = last + 1
    const output = [
      `<stream name="${name}" path="${filepath}">`,
      file.raw.map((line, i) => `${i + file.offset}: ${line}`).join("\n"),
    ]
    if (file.cut) {
      output.push(
        `\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)`,
      )
    } else if (file.more) {
      output.push(`\n(Showing lines ${file.offset}-${last} of ${file.count}. Use offset=${next} to continue.)`)
    } else {
      output.push(`\n(End of stream - total ${file.count} lines)`)
    }
    output.push(`</stream>`)
    return output
  }

  return [
    ...parts,
    ...render("stdout", result.stdout, result.info.stdout_path),
    ...render("stderr", result.stderr, result.info.stderr_path),
  ].join("\n")
}
