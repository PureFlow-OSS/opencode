import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { MainConfigFactory } from "electron-vite"
import { build } from "vite"
import createConfig from "./electron.vite.config"
import pkg from "./package.json"
import { CLI_BINARIES, nodePtyPackage } from "./scripts/utils"

const load = async (command: "build" | "serve") => ({
  config: await createConfig({ command, mode: command === "build" ? "production" : "development" }),
})

test.each(["prod", "latest", "dev", "beta", "local", undefined])(
  "keeps the CLI service channel separate from desktop identity: %s",
  async (channel) => {
    const previous = process.env.OPENCODE_CHANNEL

    try {
      if (channel === undefined) delete process.env.OPENCODE_CHANNEL
      else process.env.OPENCODE_CHANNEL = channel
      expect((await load("build")).config.main?.define?.["import.meta.env.OPENCODE_CLI_CHANNEL"]).toBe(
        JSON.stringify(channel ?? "latest"),
      )
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CHANNEL
      else process.env.OPENCODE_CHANNEL = previous
    }
  },
)

test("embeds the corporate updater URL only when the build supplies it", async () => {
  const previous = process.env.OPENCODE_UPDATE_BASE_URL
  try {
    process.env.OPENCODE_UPDATE_BASE_URL = "https://updates.example/opencode/"
    expect((await load("build")).config.main?.define).toMatchObject({
      OPENCODE_UPDATE_BASE_URL: JSON.stringify("https://updates.example/opencode/"),
    })
    delete process.env.OPENCODE_UPDATE_BASE_URL
    expect((await load("build")).config.main?.define).toMatchObject({
      OPENCODE_UPDATE_BASE_URL: "undefined",
    })
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_UPDATE_BASE_URL
    else process.env.OPENCODE_UPDATE_BASE_URL = previous
  }
})

test("embeds the corporate updater cache directory only when the build supplies it", async () => {
  const previous = process.env.OPENCODE_UPDATE_CACHE_DIR

  try {
    process.env.OPENCODE_UPDATE_CACHE_DIR = "C:/Entwicklung"
    expect((await load("build")).config.main?.define).toMatchObject({
      OPENCODE_UPDATE_CACHE_DIR: JSON.stringify("C:/Entwicklung"),
    })

    delete process.env.OPENCODE_UPDATE_CACHE_DIR
    expect((await load("build")).config.main?.define).toMatchObject({
      OPENCODE_UPDATE_CACHE_DIR: "undefined",
    })
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_UPDATE_CACHE_DIR
    else process.env.OPENCODE_UPDATE_CACHE_DIR = previous
  }
})

test("embeds the corporate updater URL in the packaged main bundle", async () => {
  const previous = process.env.OPENCODE_UPDATE_BASE_URL

  try {
    process.env.OPENCODE_UPDATE_BASE_URL = "https://updates.example/opencode"
    const config = await createConfig({ command: "build", mode: "production" })
    if (!config.main) throw new Error("Missing main-process build configuration")

    const built = await new MainConfigFactory(
      config.main,
      { configFile: false, mode: "production" },
      { root: import.meta.dirname },
    ).build()
    built.build = { ...built.build, minify: false, write: false }
    built.logLevel = "silent"
    const output = await build(built)
    const chunks = (Array.isArray(output) ? output : [output]).flatMap((item) =>
      "output" in item ? item.output.filter((entry) => entry.type === "chunk") : [],
    )

    expect(chunks.some((chunk) => chunk.code.includes("https://updates.example/opencode"))).toBe(true)
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_UPDATE_BASE_URL
    else process.env.OPENCODE_UPDATE_BASE_URL = previous
  }
}, 30_000)

// Bundled into the main process, so the manifest must not also ship them as external packages.
const bundled = ["effect", "@effect/platform-node", "@effect/platform-node-shared", "drizzle-orm"]

test("minifies only builds, previews onboarding only in development, and ships sourcemaps and public assets", async () => {
  const previous = process.env.OPENCODE_TEST_ONBOARDING
  const previousTarget = process.env.OPENCODE_CLI_TARGET

  try {
    process.env.OPENCODE_TEST_ONBOARDING = "1"

    for (const command of ["build", "serve"] as const) {
      const result = await load(command)

      for (const target of [result.config.main, result.config.preload, result.config.renderer])
        expect(target?.build?.minify).toBe(command === "build")
      expect(result.config.renderer?.define?.["import.meta.env.OPENCODE_TEST_ONBOARDING"]).toBe(
        JSON.stringify(command === "serve"),
      )
    }

    delete process.env.OPENCODE_TEST_ONBOARDING
    const serve = await load("serve")
    expect(serve.config.renderer?.define?.["import.meta.env.OPENCODE_TEST_ONBOARDING"]).toBe("false")

    for (const item of CLI_BINARIES) {
      process.env.OPENCODE_CLI_TARGET = item.target
      const main = (await load("build")).config.main
      expect(main?.build?.externalizeDeps).toEqual({
        exclude: bundled,
        include: [nodePtyPackage(item.target)],
      })
    }
  } finally {
    delete process.env.OPENCODE_TEST_ONBOARDING
    delete process.env.OPENCODE_CLI_TARGET

    if (previous !== undefined) process.env.OPENCODE_TEST_ONBOARDING = previous

    if (previousTarget !== undefined) process.env.OPENCODE_CLI_TARGET = previousTarget
  }

  const renderer = (await load("build")).config.renderer
  // Sentry uploads the renderer source maps, then deletes them.
  expect(renderer?.build?.sourcemap).toBe(true)

  // Vite resolves publicDir from the renderer root, not from the config file.
  const root = renderer?.root ?? ""
  const publicDir = renderer?.publicDir || ""
  expect(existsSync(path.resolve(import.meta.dirname, root, publicDir, "oc-theme-preload.js"))).toBe(true)
})

test("bundles one Effect runtime and Drizzle while keeping native dependencies external", async () => {
  for (const name of bundled) {
    expect(Object.keys(pkg.dependencies)).not.toContain(name)
    expect(Object.keys(pkg.optionalDependencies)).not.toContain(name)
  }

  expect(Object.keys(pkg.optionalDependencies).filter((name) => name.startsWith("@lydell/node-pty-"))).toEqual([
    "@lydell/node-pty-darwin-arm64",
    "@lydell/node-pty-darwin-x64",
    "@lydell/node-pty-linux-arm64",
    "@lydell/node-pty-linux-x64",
    "@lydell/node-pty-win32-arm64",
    "@lydell/node-pty-win32-x64",
  ])

  const previousTarget = process.env.OPENCODE_CLI_TARGET
  // Build against the opposite architecture to prove cross-packaging resolves the target's native package, not the host's.
  const crossTarget = process.arch === "arm64" ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc"
  const crossNodePty = nodePtyPackage(crossTarget)

  try {
    process.env.OPENCODE_CLI_TARGET = crossTarget
    const result = await load("build")

    if (!result.config.main) throw new Error("Missing main-process build configuration")

    const config = await new MainConfigFactory(
      result.config.main,
      { configFile: false, mode: "production" },
      { root: import.meta.dirname },
    ).build()

    config.build = { ...config.build, minify: false, write: false }
    config.logLevel = "silent"
    const output = await build(config)

    const chunks = (Array.isArray(output) ? output : [output]).flatMap((item) =>
      "output" in item ? item.output.filter((entry) => entry.type === "chunk") : [],
    )

    expect(chunks.length).toBeGreaterThan(0)
    // Resource resolution must not depend on which lazy entry owns DesktopPaths.
    expect(chunks.every((chunk) => !chunk.fileName.includes("/"))).toBe(true)
    const imports = chunks.flatMap((chunk) => [...chunk.imports, ...chunk.dynamicImports])
    const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules))

    for (const name of bundled) {
      expect(imports.filter((id) => id === name || id.startsWith(`${name}/`))).toEqual([])
      expect(modules.some((id) => id.includes(`/node_modules/${name}/`))).toBe(true)
    }

    const effect = modules.filter((id) => id.includes("/node_modules/effect/"))
    expect(new Set(effect.map((id) => id.split("/node_modules/effect/")[0])).size).toBe(1)
    expect(new Set(effect).size).toBe(effect.length)
    expect(imports).toContain("electron")
    expect(imports).toContain("node:sqlite")
    expect(chunks.some((chunk) => chunk.dynamicImports.includes("@zip.js/zip.js"))).toBe(true)
    expect(imports).toContain(crossNodePty)
    expect(imports).not.toContain(`@lydell/node-pty-${process.platform}-${process.arch}`)
    expect(modules.some((id) => id.includes("/node_modules/msgpackr"))).toBe(false)
    expect(chunks.some((chunk) => chunk.code.includes("msgpackr"))).toBe(false)
  } finally {
    delete process.env.OPENCODE_CLI_TARGET

    if (previousTarget !== undefined) process.env.OPENCODE_CLI_TARGET = previousTarget
  }
}, 30_000)
