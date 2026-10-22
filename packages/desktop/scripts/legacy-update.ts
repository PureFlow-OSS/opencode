import { createHash, createPublicKey, verify } from "node:crypto"
import { rm } from "node:fs/promises"
import path from "node:path"

// Embedded in the shipped dev 1.14.x Tauri clients. Never generate a new key for migration.
export const legacyPublicKey =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEYwMDM5Nzg5OUMzOUExMDQKUldRRW9UbWNpWmNEOENYT01CV0lhOXR1UFhpaXJsK1Z3aU9lZnNtNzE0TDROWVMwVW9XQnFOelkK"

export async function verifyLegacySignature(file: string, signature: string, publicKey: string) {
  const key = Buffer.from(Buffer.from(publicKey, "base64").toString("utf8").trim().split(/\r?\n/)[1] ?? "", "base64")
  const lines = Buffer.from(signature.trim(), "base64").toString("utf8").trim().split(/\r?\n/)
  const signed = Buffer.from(lines[1] ?? "", "base64")
  const global = Buffer.from(lines[3] ?? "", "base64")
  if (
    key.length !== 42 ||
    key.subarray(0, 2).toString() !== "Ed" ||
    signed.length !== 74 ||
    signed.subarray(0, 2).toString() !== "ED" ||
    global.length !== 64 ||
    !lines[2]?.startsWith("trusted comment: ")
  )
    throw new Error("Invalid Tauri/minisign signature format")
  if (!key.subarray(2, 10).equals(signed.subarray(2, 10)))
    throw new Error("Tauri signing key does not match the installed legacy client")
  const digest = createHash("blake2b512")
  for await (const chunk of Bun.file(file).stream()) digest.update(chunk)
  const ed25519 = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]),
    format: "der",
    type: "spki",
  })
  if (
    !verify(null, digest.digest(), ed25519, signed.subarray(10)) ||
    !verify(
      null,
      Buffer.concat([signed.subarray(10), Buffer.from(lines[2].slice("trusted comment: ".length))]),
      ed25519,
      global,
    )
  )
    throw new Error("Tauri signature does not match the final installer bytes")
}

export async function legacyUpdateManifest(input: { directory: string; version: string; publicKey: string }) {
  await rm(path.join(input.directory, "latest.json"), { force: true })
  const metadata = await Bun.file(path.join(input.directory, "latest.yml")).text()
  if (metadata.match(/^version:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m)?.[1] !== input.version)
    throw new Error("Legacy manifest version does not match latest.yml")
  const platforms: Record<string, { url: string; signature: string }> = {}
  for (const [arch, target] of [
    ["x64", "x86_64"],
    ["arm64", "aarch64"],
  ]) {
    const name = `opencode-desktop-win-${arch}.exe`
    const file = path.join(input.directory, name)
    if (!(await Bun.file(file).exists())) continue
    const signature = (await Bun.file(file + ".sig").text()).trim()
    await verifyLegacySignature(file, signature, input.publicKey)
    // Bind the migration to electron-updater's metadata, after Authenticode signing.
    const entry = metadata.split(/\r?\n/).findIndex((line) => line.trim() === `- url: ${name}`)
    const hash = metadata
      .split(/\r?\n/)
      [entry + 1]?.trim()
      .match(/^sha512:\s*(\S+)$/)?.[1]
    const digest = createHash("sha512")
    for await (const chunk of Bun.file(file).stream()) digest.update(chunk)
    if (entry < 0 || digest.digest("base64") !== hash) throw new Error("Installer does not match latest.yml: " + name)
    platforms[`windows-${target}`] = { url: name, signature }
    platforms[`windows-${target}-nsis`] = { url: name, signature }
  }
  if (!Object.keys(platforms).length) throw new Error("No Windows Electron installer found")
  const manifest = {
    version: input.version,
    notes: await Bun.file(path.join(input.directory, "changelog.md")).text(),
    pub_date: new Date().toISOString(),
    platforms,
  }
  await Bun.write(path.join(input.directory, "latest.json"), JSON.stringify(manifest, null, 2) + "\n")
  return manifest
}

if (import.meta.main) {
  const [directory, version] = process.argv.slice(2)
  if (!directory || !version) throw new Error("Usage: bun legacy-update.ts <output-directory> <version>")
  await legacyUpdateManifest({ directory, version, publicKey: legacyPublicKey })
  console.log("Prepared and verified legacy Tauri update manifest for " + version)
}
