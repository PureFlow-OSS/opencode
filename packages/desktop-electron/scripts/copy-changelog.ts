#!/usr/bin/env bun
import fs from "node:fs/promises"
import path from "node:path"

const outputDir = process.env.OPENCODE_ELECTRON_OUTPUT_DIR?.trim() || "dist"
const rootDir = path.resolve(import.meta.dir, "../../..")

await fs.mkdir(path.join(rootDir, "packages", "desktop-electron", outputDir), { recursive: true })
await fs.copyFile(
  path.join(rootDir, "changelog.md"),
  path.join(rootDir, "packages", "desktop-electron", outputDir, "changelog.md"),
)

