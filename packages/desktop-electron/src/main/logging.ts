import log from "electron-log/main.js"
import { readFile, readdir, stat, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"

const MAX_LOG_AGE_DAYS = 7
const TAIL_LINES = 1000

export function initLogging() {
  log.transports.file.maxSize = 5 * 1024 * 1024
  void cleanup()
  return log
}

export async function tail(): Promise<string> {
  try {
    const path = log.transports.file.getFile().path
    const contents = await readFile(path, "utf8")
    const lines = contents.split("\n")
    return lines.slice(Math.max(0, lines.length - TAIL_LINES)).join("\n")
  } catch {
    return ""
  }
}

async function cleanup() {
  const path = log.transports.file.getFile().path
  const dir = dirname(path)
  const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }

  await Promise.all(
    entries.map(async (entry) => {
      const file = join(dir, entry)
      try {
        const info = await stat(file)
        if (!info.isFile()) return
        if (info.mtimeMs < cutoff) await unlink(file)
      } catch {
        // ignore individual file errors
      }
    }),
  )
}
