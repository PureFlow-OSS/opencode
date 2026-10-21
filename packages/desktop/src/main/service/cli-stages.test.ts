import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { cleanStages, stageCli } from "./cli-stages"
import { cliBuildID } from "./cli-build"

test("same-version rebuilds stage different executables and preserve the old copy", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "opencode-cli-rebuild-"))

  try {
    const first = path.join(root, "first", "opencode-cli.exe")
    const second = path.join(root, "second", "opencode-cli.exe")
    mkdirSync(path.dirname(first))
    mkdirSync(path.dirname(second))
    writeFileSync(first, "old CLI")
    writeFileSync(second, "fixed CLI")
    const firstBuild = await cliBuildID(first)
    const secondBuild = await cliBuildID(second)
    expect(secondBuild).not.toBe(firstBuild)

    const stage = (source: string, buildID: string) =>
      Effect.runPromise(
        stageCli(source, path.join(root, "staged"), "2.1.2", buildID).pipe(
          Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
        ),
      )

    const old = await stage(first, firstBuild)
    const current = await stage(second, secondBuild)
    expect(current).not.toBe(old)
    expect(await Bun.file(old).text()).toBe("old CLI")
    expect(await Bun.file(current).text()).toBe("fixed CLI")
    expect(await stage(second, secondBuild)).toBe(current)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("cleanStages", () => {
  test.each([
    { name: "upgrade", staged: ["2.0.18", "2.0.19", "2.0.20"], current: "2.0.20" },
    { name: "downgrade", staged: ["2.0.18", "2.0.19", "2.0.20"], current: "2.0.18" },
    { name: "prerelease", staged: ["2.0.20", "2.1.0-beta.1", "local"], current: "2.1.0-beta.1" },
    { name: "only current", staged: ["2.0.20"], current: "2.0.20" },
  ])("keeps only the current staged CLI after $name", async (input) => {
    const root = mkdtempSync(path.join(tmpdir(), "opencode-cli-stages-"))

    try {
      input.staged.forEach((version) => {
        mkdirSync(path.join(root, version))
        writeFileSync(path.join(root, version, "opencode-cli"), version)
      })
      writeFileSync(path.join(root, "unrelated"), "")

      await Effect.runPromise(
        cleanStages(path.join(root, input.current, "opencode-cli")).pipe(
          Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
        ),
      )

      expect(readdirSync(root).sort()).toEqual([input.current, "unrelated"])
      expect(readdirSync(path.join(root, input.current))).toEqual(["opencode-cli"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
