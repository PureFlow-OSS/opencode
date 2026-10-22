import { expect, test } from "bun:test"
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { legacyPublicKey, legacyUpdateManifest, verifyLegacySignature } from "./legacy-update"

test("legacy manifest binds both NSIS target aliases to the final installer and original signing key", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-legacy-manifest-"))
  const key = generateKeyPairSync("ed25519")
  const id = randomBytes(8)
  const publicKey = Buffer.from(
    "untrusted comment: test key\n" +
      Buffer.concat([
        Buffer.from("Ed"),
        id,
        key.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
      ]).toString("base64") +
      "\n",
  ).toString("base64")
  const data = Buffer.from("MZ installer bytes after Authenticode signing")
  const signature = sign(null, createHash("blake2b512").update(data).digest(), key.privateKey)
  const comment = "timestamp:1792684800\tfile:opencode-desktop-win-x64.exe"
  const envelope = Buffer.from(
    [
      "untrusted comment: signature from minisign secret key",
      Buffer.concat([Buffer.from("ED"), id, signature]).toString("base64"),
      "trusted comment: " + comment,
      sign(null, Buffer.concat([signature, Buffer.from(comment)]), key.privateKey).toString("base64"),
      "",
    ].join("\n"),
  ).toString("base64")
  const file = path.join(dir, "opencode-desktop-win-x64.exe")
  try {
    await Bun.write(file, data)
    await Bun.write(file + ".sig", envelope)
    await Bun.write(
      path.join(dir, "latest.yml"),
      [
        "version: 2.1.2",
        "files:",
        "  - url: opencode-desktop-win-x64.exe",
        "    sha512: " + createHash("sha512").update(data).digest("base64"),
      ].join("\n"),
    )
    await Bun.write(path.join(dir, "changelog.md"), "Migration notes")
    const manifest = await legacyUpdateManifest({ directory: dir, version: "2.1.2", publicKey })
    expect(manifest.platforms["windows-x86_64"]).toEqual({ url: "opencode-desktop-win-x64.exe", signature: envelope })
    expect(manifest.platforms["windows-x86_64-nsis"]).toEqual(manifest.platforms["windows-x86_64"])
    expect(Object.keys(manifest.platforms)).toHaveLength(2)
    expect(manifest.notes).toBe("Migration notes")
    expect(await Bun.file(path.join(dir, "latest.json")).json()).toEqual(manifest)
    await expect(verifyLegacySignature(file, envelope, legacyPublicKey)).rejects.toThrow("signing key does not match")
    await expect(legacyUpdateManifest({ directory: dir, version: "2.1.3", publicKey })).rejects.toThrow("version")
    await Bun.write(
      path.join(dir, "latest.yml"),
      "version: 2.1.2\nfiles:\n  - url: opencode-desktop-win-x64.exe\n    sha512: stale\n",
    )
    await expect(legacyUpdateManifest({ directory: dir, version: "2.1.2", publicKey })).rejects.toThrow(
      "does not match latest.yml",
    )
    await Bun.write(file, "modified after signing")
    await expect(verifyLegacySignature(file, envelope, publicKey)).rejects.toThrow("final installer bytes")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
