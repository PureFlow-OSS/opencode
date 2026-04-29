#!/usr/bin/env bun
import { $ } from "bun"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
if (process.platform === "win32") await $`bun ./scripts/build-updater-helper.ts`

await $`cd ../opencode && bun script/build-node.ts`
