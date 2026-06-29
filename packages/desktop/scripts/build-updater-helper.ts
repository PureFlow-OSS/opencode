#!/usr/bin/env bun
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

import { $ } from "bun"

const helperProjectDir = path.join(import.meta.dir, "..", "updater-helper")
const outputDir = path.join(import.meta.dir, "..", "build", "updater-helper", "win-x64")

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })
await $`dotnet publish ${helperProjectDir} -c Release -r win-x64 --self-contained true /p:PublishSingleFile=true /p:PublishTrimmed=false -o ${outputDir}`
