#!/usr/bin/env bun
import { $ } from "bun"
import { exists } from "node:fs/promises"
import path from "node:path"
import { copyBuiltCliToResources, downloadCliToResources, getCurrentCli, resolveChannel } from "./utils"

// Prepares resources/ (icons, metainfo, the bundled CLI) for OPENCODE_CHANNEL and builds the app into out/.
// The CLI comes from ../cli/dist when it holds the target; otherwise dev downloads the published dev CLI,
// beta the beta CLI, and prod fails.
const dir = path.resolve(import.meta.dir, "..")

const cli = path.resolve(dir, process.env.OPENCODE_CLI_DIST ?? "../cli/dist")

const channel = resolveChannel()

process.chdir(dir)

if (process.platform === "win32") await $`bun ./script/build-updater-helper.ts`

await $`bun ./script/copy-icons.ts ${channel}`

await $`bun ./script/copy-metainfo.ts ${channel}`

const built = await exists(path.join(cli, getCurrentCli().package.replace("@opencode/", "")))

if (channel === "prod" && !built)
  throw new Error(`Production desktop builds bundle the CLI from ${cli}; build it first`)

if (built) await copyBuiltCliToResources(cli)

if (!built) await downloadCliToResources(channel === "beta" ? "beta" : undefined)

await $`bunx electron-vite build`
