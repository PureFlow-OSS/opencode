#!/usr/bin/env bun
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const VERSION = "15.1.0"
const config =
  process.arch === "arm64"
    ? { platform: "aarch64-pc-windows-msvc", extension: "zip" }
    : { platform: "x86_64-pc-windows-msvc", extension: "zip" }

if (process.platform !== "win32") process.exit(0)

const root = path.resolve(import.meta.dir, "..")
const target = path.join(root, "resources", "bin", "rg.exe")
if (await Bun.file(target).exists()) {
  console.log(`Using bundled ripgrep at ${target}`)
  process.exit(0)
}

const filename = `ripgrep-${VERSION}-${config.platform}.${config.extension}`
const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}`
const temp = path.join(os.tmpdir(), "opencode-ripgrep")
const archive = path.join(temp, filename)
const extracted = path.join(temp, `ripgrep-${VERSION}-${config.platform}`, "rg.exe")

await fs.mkdir(path.dirname(target), { recursive: true })
await fs.mkdir(temp, { recursive: true })

const response = await fetch(url)
if (!response.ok) throw new Error(`Failed to download ripgrep from ${url}: ${response.status} ${response.statusText}`)

await Bun.write(archive, new Uint8Array(await response.arrayBuffer()))
const powershell = Bun.spawn(
  [
    "powershell",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "& { param([string]$archive, [string]$destination) $ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }",
    archive,
    temp,
  ],
  {
    stdout: "inherit",
    stderr: "inherit",
  },
)
if ((await powershell.exited) !== 0) throw new Error("Failed to extract ripgrep archive")

if (!(await Bun.file(extracted).exists())) {
  throw new Error(`ripgrep archive did not contain rg.exe at ${extracted}`)
}

await fs.copyFile(extracted, target)
console.log(`Bundled ripgrep at ${target}`)
