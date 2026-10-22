#!/usr/bin/env bun
import { stat } from "node:fs/promises"
import path from "node:path"

import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } from "@zip.js/zip.js"

type ManifestFile = {
  url: string
  sha512: string
  size: number
  blockMapSize?: number
}

type Manifest = {
  releaseDate: string
  files: ManifestFile[]
}

const manifests = [
  {
    name: "latest.yml",
    sources: [
      ["latest-yml-aarch64-pc-windows-msvc", "latest.yml"],
      ["latest-yml-x86_64-pc-windows-msvc", "latest.yml"],
    ],
  },
  {
    name: "latest-mac.yml",
    sources: [
      ["latest-yml-aarch64-apple-darwin", "latest-mac.yml"],
      ["latest-yml-x86_64-apple-darwin", "latest-mac.yml"],
    ],
  },
  { name: "latest-linux.yml", sources: [["latest-yml-x86_64-unknown-linux-gnu", "latest-linux.yml"]] },
  { name: "latest-linux-arm64.yml", sources: [["latest-yml-aarch64-unknown-linux-gnu", "latest-linux-arm64.yml"]] },
] as const satisfies readonly { name: string; sources: readonly (readonly [string, string])[] }[]

export async function packageCorporateRelease(options: {
  readonly assets: string
  readonly metadata: string
  readonly output: string
  readonly version: string
  readonly releaseNotes?: string
}) {
  const output = path.resolve(options.output)
  const files = await releaseFiles(options.assets, output)
  const metadata = await Promise.all(
    manifests.map(
      async (manifest) =>
        [
          manifest.name,
          await mergeManifest({
            directory: options.metadata,
            sources: manifest.sources,
            version: options.version,
            files,
          }),
        ] as const,
    ),
  )
  const changelog = await changelogContent({
    file: path.join(options.assets, "changelog.md"),
    version: options.version,
    releaseNotes: options.releaseNotes,
  })
  const legacy = Bun.file(path.join(options.assets, "latest.json"))
  const legacyContent = (await legacy.exists()) ? await legacy.text() : undefined
  if (legacyContent) {
    const manifest: unknown = JSON.parse(legacyContent)
    if (!manifest || typeof manifest !== "object" || !("version" in manifest) || manifest.version !== options.version)
      throw new Error("Legacy update manifest version does not match the release")
  }

  const zip = new ZipWriter(new BlobWriter("application/zip"), { level: 0 })
  for (const [name, content] of metadata) await zip.add(name, new TextReader(content))
  for (const file of files) await zip.add(path.basename(file), new BlobReader(Bun.file(file)))
  await zip.add("changelog.md", new TextReader(changelog))
  if (legacyContent) await zip.add("latest.json", new TextReader(legacyContent))

  await Bun.write(output, await zip.close())

  const verify = new ZipReader(new BlobReader(Bun.file(output)))
  const entries = await verify.getEntries()
  await verify.close()
  const expected = files.length + manifests.length + 1 + (legacyContent ? 1 : 0)
  if (entries.length !== expected) throw new Error("Corporate release ZIP entry count does not match")
  console.log("packaged " + entries.length + " corporate entries for " + options.version)
}

async function releaseFiles(directory: string, output: string) {
  const files = (
    await Array.fromAsync(
      new Bun.Glob("*.{exe,sig,blockmap,dmg,zip,AppImage,deb,rpm,app.tar.gz}").scan({ cwd: directory, absolute: true }),
    )
  )
    .map((file) => path.resolve(file))
    .filter((file) => file !== output)
    .sort()
  if (!files.length) throw new Error("Corporate release archive contained no desktop assets")
  if (new Set(files.map((file) => path.basename(file))).size !== files.length)
    throw new Error("Corporate release assets contain duplicate platform filenames")
  for (const file of files) await requireFile(file)
  return files
}

async function mergeManifest(input: {
  readonly directory: string
  readonly sources: readonly (readonly [string, string])[]
  readonly version: string
  readonly files: readonly string[]
}) {
  const parts = await Promise.all(
    input.sources.map(async ([subdirectory, source]) => {
      const file = Bun.file(path.join(input.directory, subdirectory, source))
      return parseManifest(await file.text(), input.version, source)
    }),
  )
  const manifest = { releaseDate: parts[0]!.releaseDate, files: parts.flatMap((part) => part.files) }
  const available = new Set(input.files.map((file) => path.basename(file)))
  const missing = manifest.files.map((file) => path.basename(file.url)).filter((name) => !available.has(name))
  if (missing.length)
    throw new Error("Corporate release manifests referenced missing assets: " + [...new Set(missing)].join(", "))

  return (
    [
      "version: " + input.version,
      "releaseDate: " + manifest.releaseDate,
      "files:",
      ...manifest.files.flatMap((file) => [
        "  - url: " + file.url,
        "    sha512: " + file.sha512,
        "    size: " + file.size,
        ...(file.blockMapSize === undefined ? [] : ["    blockMapSize: " + file.blockMapSize]),
      ]),
      "path: " + path.basename(manifest.files[0]!.url),
      "sha512: " + manifest.files[0]!.sha512,
    ].join("\n") + "\n"
  )
}

function parseManifest(content: string, version: string, source: string): Manifest {
  const lines = content.split("\n")
  const found = lines
    .find((line) => line.startsWith("version:"))
    ?.slice("version:".length)
    .trim()
  if (found !== version) throw new Error("Desktop metadata version mismatch: expected " + version + ", got " + found)

  const releaseDate = lines
    .find((line) => line.startsWith("releaseDate:"))
    ?.slice("releaseDate:".length)
    .trim()
    .replace(/^['"]|['"]$/g, "")
  if (!releaseDate) throw new Error("Desktop metadata did not include a release date: " + source)

  const files: ManifestFile[] = []
  lines.forEach((line) => {
    const value = line.trim()
    if (value.startsWith("- url:")) {
      files.push({ url: value.slice("- url:".length).trim(), sha512: "", size: 0 })
      return
    }

    const current = files.at(-1)
    if (!current || !line.startsWith(" ")) return
    if (value.startsWith("sha512:")) current.sha512 = value.slice("sha512:".length).trim()
    if (value.startsWith("size:")) current.size = Number(value.slice("size:".length).trim())
    if (value.startsWith("blockMapSize:")) current.blockMapSize = Number(value.slice("blockMapSize:".length).trim())
  })

  if (!files.length || files.some((file) => !file.sha512 || !file.size))
    throw new Error("Desktop metadata contained an incomplete file: " + source)
  return { releaseDate, files }
}

async function changelogContent(input: {
  readonly file: string
  readonly version: string
  readonly releaseNotes?: string
}) {
  const file = Bun.file(input.file)
  if (await file.exists()) return await file.text()
  return (
    "# OpenCode " +
    input.version +
    "\n\n" +
    (input.releaseNotes?.trim() || "See the published release for details.") +
    "\n"
  )
}

async function requireFile(file: string) {
  const info = await stat(file)
  if (!info.isFile() || info.size === 0) throw new Error("Corporate release file must be non-empty: " + file)
}

if (import.meta.main) {
  const args = new Map<string, string>()
  for (let index = 2; index < process.argv.length; index += 2)
    if (process.argv[index]?.startsWith("--")) args.set(process.argv[index]!, process.argv[index + 1]!)

  const assets = args.get("--assets")
  const metadata = args.get("--metadata")
  const output = args.get("--output")
  if (!assets || !metadata || !output)
    throw new Error("Usage: bun package-corporate-release.ts --assets <dir> --metadata <dir> --output <zip>")
  const version = process.env.OPENCODE_VERSION ?? path.basename(output).match(/v(\d+\.\d+\.\d+)/)?.[1]
  if (!version) throw new Error("OPENCODE_VERSION or an output file name containing the version is required")
  await packageCorporateRelease({ assets, metadata, output, version, releaseNotes: process.env.OPENCODE_RELEASE_NOTES })
}
