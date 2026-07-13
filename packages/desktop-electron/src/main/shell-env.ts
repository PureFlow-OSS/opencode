import { spawn } from "node:child_process"
import { basename } from "node:path"

const TIMEOUT = 5_000

type Probe = { type: "Loaded"; value: Record<string, string> } | { type: "Timeout" } | { type: "Unavailable" }

export function getUserShell() {
  return process.env.SHELL || "/bin/sh"
}

export function parseShellEnv(out: Buffer) {
  const env: Record<string, string> = {}
  for (const line of out.toString("utf8").split("\0")) {
    if (!line) continue
    const ix = line.indexOf("=")
    if (ix <= 0) continue
    env[line.slice(0, ix)] = line.slice(ix + 1)
  }
  return env
}

async function probe(shell: string, mode: "-il" | "-l"): Promise<Probe> {
  return new Promise((resolve) => {
    let settled = false

    const child = spawn(shell, [mode, "-c", "env -0"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    })

    const chunks: Buffer[] = []

    const timer = setTimeout(() => {
      settled = true
      child.kill()
      resolve({ type: "Timeout" })
    }, TIMEOUT)

    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk))

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      console.log(`[server] Shell env probe failed for ${shell} ${mode}: ${err.message}`)
      resolve({ type: "Unavailable" })
    })

    child.on("close", (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        console.log(`[server] Shell env probe exited with non-zero status for ${shell} ${mode}`)
        resolve({ type: "Unavailable" })
        return
      }
      const out = Buffer.concat(chunks)
      const env = parseShellEnv(out)
      if (Object.keys(env).length === 0) {
        console.log(`[server] Shell env probe returned empty env for ${shell} ${mode}`)
        resolve({ type: "Unavailable" })
        return
      }
      resolve({ type: "Loaded", value: env })
    })
  })
}

export function isNushell(shell: string) {
  const name = basename(shell).toLowerCase()
  const raw = shell.toLowerCase()
  return name === "nu" || name === "nu.exe" || raw.endsWith("\\nu.exe")
}

export async function loadShellEnv(shell: string): Promise<Record<string, string> | null> {
  if (isNushell(shell)) {
    console.log(`[server] Skipping shell env probe for nushell: ${shell}`)
    return null
  }

  const interactive = await probe(shell, "-il")
  if (interactive.type === "Loaded") {
    console.log(`[server] Loaded shell environment with -il (${Object.keys(interactive.value).length} vars)`)
    return interactive.value
  }
  if (interactive.type === "Timeout") {
    console.warn(`[server] Interactive shell env probe timed out: ${shell}`)
    return null
  }

  const login = await probe(shell, "-l")
  if (login.type === "Loaded") {
    console.log(`[server] Loaded shell environment with -l (${Object.keys(login.value).length} vars)`)
    return login.value
  }

  console.warn(`[server] Falling back to app environment: ${shell}`)
  return null
}

export function mergeShellEnv(shell: Record<string, string> | null, env: Record<string, string>) {
  return {
    ...shell,
    ...env,
  }
}

