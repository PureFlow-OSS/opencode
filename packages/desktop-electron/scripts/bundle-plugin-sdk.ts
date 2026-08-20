import fs from "node:fs/promises"
import path from "node:path"

const outdir = path.join(import.meta.dirname, "../build/offline-plugin")
const plugin = path.join(import.meta.dirname, "../../plugin")

await fs.rm(outdir, { recursive: true, force: true })
await fs.mkdir(outdir, { recursive: true })

const result = await Bun.build({
  entrypoints: [path.join(plugin, "src/index.ts"), path.join(plugin, "src/tool.ts"), path.join(plugin, "src/tui.ts")],
  outdir,
  target: "node",
  format: "esm",
  naming: "[name].js",
  minify: true,
})

if (!result.success) throw new AggregateError(result.logs, "Failed to bundle @opencode-ai/plugin")

const pkg = await Bun.file(path.join(plugin, "package.json")).json()
await Bun.write(
  path.join(outdir, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      type: "module",
      exports: {
        ".": "./index.js",
        "./tool": "./tool.js",
        "./tui": "./tui.js",
      },
    },
    null,
    2,
  ) + "\n",
)
