#!/usr/bin/env bun
import fs from "node:fs/promises"
import path from "node:path"

const outputDir = process.env.OPENCODE_ELECTRON_OUTPUT_DIR?.trim() || "dist"
const rootDir = path.resolve(import.meta.dir, "../../..")
const packageDir = path.resolve(import.meta.dir, "..")

await fs.mkdir(path.join(packageDir, outputDir), { recursive: true })
await fs.copyFile(
  path.join(rootDir, "changelog.md"),
  path.join(packageDir, outputDir, "changelog.md"),
)
