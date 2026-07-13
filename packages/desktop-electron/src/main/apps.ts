import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const EXEC_TIMEOUT = 3_000

export async function checkAppExists(appName: string): Promise<boolean> {
  if (process.platform === "win32") return true
  if (process.platform === "linux") return true
  return checkMacosApp(appName)
}

export async function resolveAppPath(appName: string): Promise<string | null> {
  if (process.platform !== "win32") return appName
  return resolveWindowsAppPath(appName)
}

export async function wslPath(path: string, mode: "windows" | "linux" | null): Promise<string> {
  if (process.platform !== "win32") return path

  const flag = mode === "windows" ? "-w" : "-u"
  try {
    if (path.startsWith("~")) {
      const suffix = path.slice(1)
      const cmd = `wslpath ${flag} "$HOME${suffix.replace(/"/g, '\\"')}"`
      const { stdout } = await execFileAsync("wsl", ["-e", "sh", "-lc", cmd], { timeout: EXEC_TIMEOUT })
      return stdout.trim()
    }

    const { stdout } = await execFileAsync("wsl", ["-e", "wslpath", flag, path], { timeout: EXEC_TIMEOUT })
    return stdout.trim()
  } catch (error) {
    throw new Error(`Failed to run wslpath: ${String(error)}`, { cause: error })
  }
}

async function checkMacosApp(appName: string): Promise<boolean> {
  const locations = [`/Applications/${appName}.app`, `/System/Applications/${appName}.app`]

  const home = process.env.HOME
  if (home) locations.push(`${home}/Applications/${appName}.app`)

  if (locations.some((location) => existsSync(location))) return true

  try {
    await execFileAsync("which", [appName], { timeout: EXEC_TIMEOUT })
    return true
  } catch {
    return false
  }
}

async function resolveWindowsAppPath(appName: string): Promise<string | null> {
  let output: string
  try {
    const result = await execFileAsync("where", [appName], { timeout: EXEC_TIMEOUT })
    output = result.stdout
  } catch {
    return null
  }

  const paths = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const hasExt = (path: string, ext: string) => extname(path).toLowerCase() === `.${ext}`

  const exe = paths.find((path) => hasExt(path, "exe"))
  if (exe) return exe

  const resolveCmd = async (path: string): Promise<string | null> => {
    let content: string
    try {
      content = await readFile(path, "utf8")
    } catch {
      return null
    }
    for (const token of content.split('"').map((value: string) => value.trim())) {
      const lower = token.toLowerCase()
      if (!lower.includes(".exe")) continue

      const index = lower.indexOf("%~dp0")
      if (index >= 0) {
        const base = dirname(path)
        const suffix = token.slice(index + 5)
        const resolved = suffix
          .replace(/\//g, "\\")
          .split("\\")
          .filter((part: string) => part && part !== ".")
          .reduce((current: string, part: string) => {
            if (part === "..") return dirname(current)
            return join(current, part)
          }, base)

        if (existsSync(resolved)) return resolved
      }

      if (existsSync(token)) return token
    }

    return null
  }

  for (const path of paths) {
    if (hasExt(path, "cmd") || hasExt(path, "bat")) {
      const resolved = await resolveCmd(path)
      if (resolved) return resolved
    }

    if (!extname(path)) {
      const cmd = `${path}.cmd`
      if (existsSync(cmd)) {
        const resolved = await resolveCmd(cmd)
        if (resolved) return resolved
      }

      const bat = `${path}.bat`
      if (existsSync(bat)) {
        const resolved = await resolveCmd(bat)
        if (resolved) return resolved
      }
    }
  }

  const key = appName
    .split("")
    .filter((value: string) => /[a-z0-9]/i.test(value))
    .map((value: string) => value.toLowerCase())
    .join("")

  if (key) {
    for (const path of paths) {
      const dirs = [dirname(path), dirname(dirname(path)), dirname(dirname(dirname(path)))]
      for (const dir of dirs) {
        try {
          const entries = await readdir(dir)
          for (const entry of entries) {
            const candidate = join(dir, entry)
            if (!hasExt(candidate, "exe")) continue
            const stem = entry.replace(/\.exe$/i, "")
            const name = stem
              .split("")
              .filter((value: string) => /[a-z0-9]/i.test(value))
              .map((value: string) => value.toLowerCase())
              .join("")
            if (name.includes(key) || key.includes(name)) return candidate
          }
        } catch {
          continue
        }
      }
    }
  }

  return paths[0] ?? null
}

