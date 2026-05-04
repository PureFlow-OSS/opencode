import path from "path"
import { Effect, Option, Schema } from "effect"
import * as Stream from "effect/Stream"
import { InstanceState } from "@/effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./glob.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The glob pattern to match files against" }),
  path: Schema.optional(Schema.String).annotate({
    description: `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
  }),
})

const LIMIT = 100
const TIMEOUT = "30 seconds"
const DEFAULT_IGNORES = [
  "node_modules",
  "bower_components",
  ".pnpm-store",
  "vendor",
  ".npm",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "bin",
  "obj",
  ".git",
  ".svn",
  ".hg",
  ".vscode",
  ".idea",
  ".turbo",
  ".output",
  "desktop",
  ".sst",
  ".cache",
  ".webkit-cache",
  "__pycache__",
  ".pytest_cache",
  "mypy_cache",
  ".history",
  ".gradle",
]

function pathSegments(value: string) {
  return value.split(/[\\/]+/).filter(Boolean)
}

function globPatterns(search: string, pattern: string) {
  const explicit = new Set([...pathSegments(search), ...pathSegments(pattern)])
  return [
    ...DEFAULT_IGNORES.flatMap((dir) => {
      if (explicit.has(dir)) return []
      return [`!${dir}/**`, `!**/${dir}/**`]
    }),
    pattern,
  ]
}

export const GlobTool = Tool.define(
  "glob",
  Effect.gen(function* () {
    const rg = yield* Ripgrep.Service
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; path?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          yield* ctx.ask({
            permission: "glob",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
            },
          })

          let search = params.path ?? ins.directory
          search = path.isAbsolute(search) ? search : path.resolve(ins.directory, search)
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (info?.type === "File") {
            throw new Error(`glob path must be a directory: ${search}`)
          }
          yield* assertExternalDirectoryEffect(ctx, search, { kind: "directory" })

          let truncated = false
          const result = yield* rg
            .files({ cwd: search, glob: globPatterns(search, params.pattern), signal: ctx.abort })
            .pipe(
              Stream.mapEffect((file) =>
                Effect.gen(function* () {
                  const full = path.resolve(search, file)
                  const info = yield* fs.stat(full).pipe(Effect.catch(() => Effect.succeed(undefined)))
                  const mtime =
                    info?.mtime.pipe(
                      Option.map((date) => date.getTime()),
                      Option.getOrElse(() => 0),
                    ) ?? 0
                  return { path: full, mtime }
                }),
              ),
              Stream.take(LIMIT + 1),
              Stream.runCollect,
              Effect.map((chunk) => [...chunk]),
              Effect.map((files) => ({ files, timedOut: false })),
              Effect.timeoutOrElse({
                duration: TIMEOUT,
                orElse: () => Effect.succeed({ files: [], timedOut: true }),
              }),
            )

          if (result.timedOut) {
            return {
              title: path.relative(ins.worktree, search),
              metadata: {
                count: 0,
                truncated: true,
              },
              output: `Glob search timed out after ${TIMEOUT}. Try a more specific path or pattern.`,
            }
          }

          const files = result.files
          if (files.length > LIMIT) {
            truncated = true
            files.length = LIMIT
          }
          files.sort((a, b) => b.mtime - a.mtime)

          const output = []
          if (files.length === 0) output.push("No files found")
          if (files.length > 0) {
            output.push(...files.map((file) => file.path))
            if (truncated) {
              output.push("")
              output.push(
                `(Results are truncated: showing first ${LIMIT} results. Consider using a more specific path or pattern.)`,
              )
            }
          }

          return {
            title: path.relative(ins.worktree, search),
            metadata: {
              count: files.length,
              truncated,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
