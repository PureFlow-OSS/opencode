import { $ } from "bun"
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CLI_VERSION = "0.0.0-next-16350"

export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "prod"
}

export const SIDECAR_BINARIES: Array<{ rustTarget: string; ocBinary: string; assetExt: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    ocBinary: "opencode-darwin-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    ocBinary: "opencode-darwin-x64-baseline",
    assetExt: "zip",
  },
  {
    rustTarget: "aarch64-pc-windows-msvc",
    ocBinary: "opencode-windows-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    ocBinary: "opencode-windows-x64-baseline",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    ocBinary: "opencode-linux-x64-baseline",
    assetExt: "tar.gz",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    ocBinary: "opencode-linux-arm64",
    assetExt: "tar.gz",
  },
]

export const RUST_TARGET = Bun.env.RUST_TARGET

const CLI_BINARIES: Array<{ rustTarget: string; package: string; os: string; cpu: string }> = [
  { rustTarget: "aarch64-apple-darwin", package: "@opencode-ai/cli-darwin-arm64", os: "darwin", cpu: "arm64" },
  { rustTarget: "x86_64-apple-darwin", package: "@opencode-ai/cli-darwin-x64-baseline", os: "darwin", cpu: "x64" },
  { rustTarget: "aarch64-pc-windows-msvc", package: "@opencode-ai/cli-windows-arm64", os: "win32", cpu: "arm64" },
  { rustTarget: "x86_64-pc-windows-msvc", package: "@opencode-ai/cli-windows-x64-baseline", os: "win32", cpu: "x64" },
  { rustTarget: "x86_64-unknown-linux-gnu", package: "@opencode-ai/cli-linux-x64-baseline", os: "linux", cpu: "x64" },
  { rustTarget: "aarch64-unknown-linux-gnu", package: "@opencode-ai/cli-linux-arm64", os: "linux", cpu: "arm64" },
]

function hasWindowsSigningConfiguration() {
  const keyVault =
    (Bun.env.AZURE_KEYVAULT_URL || Bun.env.KEYVAULT_URL) &&
    (Bun.env.AZURE_KEYVAULT_CLIENT_ID || Bun.env.AZURE_CLIENT_ID) &&
    (Bun.env.AZURE_KEYVAULT_CLIENT_SECRET || Bun.env.AZURE_CLIENT_SECRET) &&
    (Bun.env.AZURE_KEYVAULT_TENANT_ID || Bun.env.AZURE_TENANT_ID) &&
    (Bun.env.AZURE_KEYVAULT_CERT || Bun.env.CERT_ALIAS || Bun.env.CertificateName)
  const trustedSigning =
    Bun.env.AZURE_TRUSTED_SIGNING_ENDPOINT &&
    Bun.env.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME &&
    Bun.env.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE
  return Boolean(keyVault || trustedSigning)
}

function nativeTarget() {
  const { platform, arch } = process
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

export async function downloadCliToResources() {
  const cli = CLI_BINARIES.find((item) => item.rustTarget === (RUST_TARGET ?? nativeTarget()))
  if (!cli) throw new Error(`CLI configuration not available for Rust target '${RUST_TARGET ?? nativeTarget()}'`)
  const directory = await mkdtemp(join(tmpdir(), "opencode-cli-"))
  const dest = windowsify("resources/opencode-cli")
  try {
    await $`bun install --no-save --cwd ${directory} ${`${cli.package}@${CLI_VERSION}`} ${`--os=${cli.os}`} ${`--cpu=${cli.cpu}`}`
    await copyFile(
      join(directory, "node_modules", cli.package, "bin", cli.os === "win32" ? "opencode2.exe" : "opencode2"),
      dest,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  if (process.platform !== "win32") await chmod(dest, 0o755)
  if (process.platform === "win32" && process.env.GITHUB_ACTIONS === "true") {
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${dest}`
  }
  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`
  console.log(`Copied ${cli.package} to ${dest}`)
}

export function getCurrentSidecar(target = RUST_TARGET ?? nativeTarget()) {
  const binaryConfig = SIDECAR_BINARIES.find((b) => b.rustTarget === target)
  if (!binaryConfig) throw new Error(`Sidecar configuration not available for Rust target '${target}'`)

  return binaryConfig
}

export async function copyBinaryToSidecarFolder(source: string) {
  const dir = `resources`
  await $`mkdir -p ${dir}`
  const dest = windowsify(`${dir}/opencode-cli`)
  await $`cp ${source} ${dest}`
  if (process.platform === "win32" && hasWindowsSigningConfiguration()) {
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${dest}`
  }
  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`

  console.log(`Copied ${source} to ${dest}`)
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
