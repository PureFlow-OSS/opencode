import { Effect, FileSystem, Path } from "effect"

// Version alone is insufficient for local rebuilds; never overwrite a CLI a service may still be executing.
export const stageCli = Effect.fn("DesktopCli.install")(function* (
  source: string,
  root: string,
  version: string,
  buildID: string,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = path.join(root, `${version}-${process.arch}-${buildID}`.replace(/[^a-zA-Z0-9._-]/g, "-"))
  const destination = path.join(directory, path.basename(source))

  if (yield* fs.exists(destination)) return destination
  const temp = destination + `.${process.pid}.tmp`
  yield* fs.makeDirectory(directory, { recursive: true })
  yield* fs.copyFile(source, temp)

  if (process.platform !== "win32") yield* fs.chmod(temp, 0o755)
  yield* fs
    .rename(temp, destination)
    .pipe(Effect.catch((error) => fs.remove(temp, { force: true }).pipe(Effect.andThen(Effect.fail(error)))))
  yield* Effect.logInfo("v2 CLI executable staged", { source, path: destination, version, buildID })

  return destination
})

// Each version and architecture stages its own copy of the CLI, and only the current one is ever started
// again: a downgrade stages its copy anew. Windows refuses to delete an executable that has not exited yet,
// so a failed removal is logged and retried on the next launch.
export const cleanStages = Effect.fn("DesktopCli.cleanStages")(function* (binary: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const current = path.dirname(binary)
  const root = path.dirname(current)
  const entries = yield* fs.readDirectory(root)
  yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* (entry) {
      const target = path.join(root, entry)

      if (target === current) return
      const stat = yield* fs.stat(target).pipe(Effect.orElseSucceed(() => undefined))

      if (stat?.type !== "Directory") return
      yield* fs
        .remove(target, { recursive: true, force: true })
        .pipe(Effect.catch((error) => Effect.logError("failed to clean staged v2 CLI", { path: target, error })))
    }),
    { concurrency: "unbounded" },
  )
})
