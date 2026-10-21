import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js"
import { packageCorporateRelease } from "./package-corporate-release"

describe("corporate release packaging", () => {
  test("merges split release artifacts and excludes a prior output on reruns", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "opencode-corporate-"))

    try {
      const assets = path.join(root, "desktop")
      const metadata = path.join(root, "latest-yml")
      await Promise.all([mkdir(assets, { recursive: true }), mkdir(metadata, { recursive: true })])
      await Promise.all(
        [
          ["latest-yml-aarch64-pc-windows-msvc/latest.yml", manifest("opencode-desktop-win-arm64.exe", "arm64-hash")],
          ["latest-yml-x86_64-pc-windows-msvc/latest.yml", manifest("opencode-desktop-win-x64.exe", "x64-hash")],
          ["latest-yml-aarch64-apple-darwin/latest-mac.yml", manifest("opencode-desktop-mac-arm64.zip", "mac-hash")],
          ["latest-yml-x86_64-apple-darwin/latest-mac.yml", manifest("opencode-desktop-mac-x64.zip", "mac-hash")],
          [
            "latest-yml-x86_64-unknown-linux-gnu/latest-linux.yml",
            manifest("opencode-desktop-linux-x64.AppImage", "linux-hash"),
          ],
          [
          "latest-yml-aarch64-unknown-linux-gnu/latest-linux-arm64.yml",
            manifest("opencode-desktop-linux-arm64.AppImage", "linux-hash"),
          ],
        ].map(async ([file, content]) => Bun.write(path.join(metadata, file), content)),
      )
      await Promise.all(
        [
          "opencode-desktop-win-arm64.exe",
          "opencode-desktop-win-x64.exe",
          "opencode-desktop-mac-arm64.zip",
          "opencode-desktop-mac-x64.zip",
          "opencode-desktop-linux-x64.AppImage",
          "opencode-desktop-linux-arm64.AppImage",
        ].map((name) => writeFile(path.join(assets, name), name)),
      )

      const output = path.join(assets, "opencode-corporate-v2.1.2.zip")
      await packageCorporateRelease({ assets, metadata, output, version: "2.1.2", releaseNotes: "Fixes" })
      await packageCorporateRelease({ assets, metadata, output, version: "2.1.2", releaseNotes: "Fixes" })

      const zip = new ZipReader(new BlobReader(Bun.file(output)))
      const entries = await zip.getEntries()
      expect(entries.map((entry) => entry.filename)).toEqual([
        "latest.yml",
        "latest-mac.yml",
        "latest-linux.yml",
        "latest-linux-arm64.yml",
        "opencode-desktop-linux-arm64.AppImage",
        "opencode-desktop-linux-x64.AppImage",
        "opencode-desktop-mac-arm64.zip",
        "opencode-desktop-mac-x64.zip",
        "opencode-desktop-win-arm64.exe",
        "opencode-desktop-win-x64.exe",
        "changelog.md",
      ])
      const latest = entries.find((entry) => entry.filename === "latest.yml")
      expect(await latest?.getData(new TextWriter())).toBe(
        [
          "version: 2.1.2",
          "releaseDate: 2026-10-21T10:00:00.000Z",
          "files:",
          "  - url: opencode-desktop-win-arm64.exe",
          "    sha512: arm64-hash",
          "    size: 7",
          "  - url: opencode-desktop-win-x64.exe",
          "    sha512: x64-hash",
          "    size: 7",
          "path: opencode-desktop-win-arm64.exe",
          "sha512: arm64-hash",
        ].join("\n") + "\n",
      )
      const changelog = entries.find((entry) => entry.filename === "changelog.md")
      expect(await changelog?.getData(new TextWriter())).toBe("# OpenCode 2.1.2\n\nFixes\n")
      await zip.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects metadata that references a missing release assets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "opencode-corporate-"))

    try {
      const metadata = path.join(root, "latest-yml")
      const assets = path.join(root, "desktop")
      await Promise.all([mkdir(assets, { recursive: true }), mkdir(metadata, { recursive: true })])
      await Promise.all(
        [
          ["latest-yml-aarch64-pc-windows-msvc/latest.yml", manifest("missing.exe", "arm64-hash")],
          ["latest-yml-x86_64-pc-windows-msvc/latest.yml", manifest("opencode-desktop-win-x64.exe", "x64-hash")],
          ["latest-yml-aarch64-apple-darwin/latest-mac.yml", manifest("opencode-desktop-mac-arm64.zip", "mac-hash")],
          ["latest-yml-x86_64-apple-darwin/latest-mac.yml", manifest("opencode-desktop-mac-x64.zip", "mac-hash")],
          [
            "latest-yml-x86_64-unknown-linux-gnu/latest-linux.yml",
            manifest("opencode-desktop-linux-x64.AppImage", "linux-hash"),
          ],
          [
            "latest-yml-aarch64-unknown-linux-gnu/latest-linux-arm64.yml",
            manifest("opencode-desktop-linux-arm64.AppImage", "linux-hash"),
          ],
        ].map(async ([file, content]) => Bun.write(path.join(metadata, file), content)),
      )
      await Promise.all(
        [
          "opencode-desktop-win-x64.exe",
          "opencode-desktop-mac-arm64.zip",
          "opencode-desktop-mac-x64.zip",
          "opencode-desktop-linux-x64.AppImage",
          "opencode-desktop-linux-arm64.AppImage",
        ].map((name) => writeFile(path.join(assets, name), name)),
      )
      await expect(
        packageCorporateRelease({ assets, metadata, output: path.join(root, "out.zip"), version: "2.1.2" }),
      ).rejects.toThrow("referenced missing assets: missing.exe")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function manifest(asset: string, sha512: string) {
  return [
    "version: 2.1.2",
    "releaseDate: 2026-10-21T10:00:00.000Z",
    "files:",
    "  - url: " + asset,
    "    sha512: " + sha512,
    "    size: 7",
    "path: " + asset,
    "sha512: " + sha512,
  ].join("\n")
}
