#!/usr/bin/env bun

import { $ } from "bun"

const channel = Bun.argv[2]
if (channel !== "beta" && channel !== "prod") throw new Error("Usage: bun ./scripts/tauri-build.ts <beta|prod>")

const source = `src-tauri/tauri.${channel}.conf.json`
const target = `src-tauri/tauri.${channel}.generated.conf.json`
const updateBaseUrl = (process.env.OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode").trim().replace(/\/$/, "")

const config = await Bun.file(source).json()

if (config.plugins?.updater) {
  config.plugins.updater.endpoints = [`${updateBaseUrl}/latest.json`]
}

await Bun.write(target, JSON.stringify(config, null, 2) + "\n")
await $`bunx tauri build --config ${target}`
