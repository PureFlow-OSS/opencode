import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import { verifyArtifact, verifySimulationGraph } from "../script/verify-artifact"

test("verifies artifact rendering and simulation graph inputs", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "verify-artifact-"))
  try {
    await Bun.write(
      path.join(fixture, "canvas.js"),
      "@napi-rs/canvas skia.win32-x64-msvc skia.darwin-arm64 skia.linux-x64-gnu",
    )
    await Bun.write(path.join(fixture, "document.pdf"), "%PDF-1.7 @napi-rs/canvas PDF renderer")
    await verifyArtifact(fixture)

    const forbidden = ["SimulationPng", "frontend/png", "Failed to register screenshot font"] as const
    for (const marker of forbidden) {
      const rejected = path.join(fixture, `rejected-${forbidden.indexOf(marker)}.txt`)
      await Bun.write(rejected, `legitimate PDF renderer ${marker}`)
      await expect(verifyArtifact(fixture)).rejects.toThrow(marker)
      await rm(rejected)
    }

    const bridges = [
      "/repo/packages/simulation/src/frontend/simulation.ts",
      "/repo/packages/simulation/src/frontend/server.ts",
      "/repo/packages/simulation/src/control-server.ts",
    ]
    const png = "/repo/packages/simulation/src/frontend/png.ts"
    expect(() => verifySimulationGraph([...bridges, png])).toThrow("Build graph contains Drive-only rendering input")
    expect(() => verifySimulationGraph(bridges)).not.toThrow()

    const empty = path.join(fixture, "empty")
    await mkdir(empty)
    await expect(verifyArtifact(empty)).rejects.toThrow("Artifact contains no published files")
  } finally {
    await rm(fixture, { force: true, recursive: true })
  }
})
