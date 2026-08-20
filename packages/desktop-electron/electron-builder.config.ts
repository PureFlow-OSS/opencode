import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (
    !process.env.AZURE_KEYVAULT_URL &&
    !process.env.KEYVAULT_URL &&
    !process.env.AZURE_TRUSTED_SIGNING_ENDPOINT
  )
    return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

async function signWindowsOutput(configuration: { appOutDir: string }) {
  if (process.platform !== "win32") return
  if (
    !process.env.AZURE_KEYVAULT_URL &&
    !process.env.KEYVAULT_URL &&
    !process.env.AZURE_TRUSTED_SIGNING_ENDPOINT
  )
    return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.appOutDir],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const shouldUseWindowsSignScript =
  process.platform === "win32" &&
  Boolean(
    process.env.AZURE_KEYVAULT_URL ||
      process.env.KEYVAULT_URL ||
      (process.env.AZURE_TRUSTED_SIGNING_ENDPOINT &&
        process.env.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME &&
        process.env.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE),
  )
const shouldEditWindowsExecutable = process.env.OPENCODE_EDIT_EXECUTABLE !== "false"
const outputDir = process.env.OPENCODE_ELECTRON_OUTPUT_DIR?.trim() || "dist"
const changelog = path.join(rootDir, "changelog.md")

async function copyChangelog() {
  const outputPath = path.resolve(process.cwd(), outputDir, "changelog.md")
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.copyFile(changelog, outputPath)
}

const getBase = (): Configuration => ({
  artifactName: "opencode-electron-${os}-${arch}.${ext}",
  directories: {
    output: outputDir,
    buildResources: "resources",
  },
  asarUnpack: ["**/*.node"],
  artifactBuildCompleted: async () => {
    await copyChangelog()
  },
  afterSign: async (context: { appOutDir: string }) => {
    await signWindowsOutput({ appOutDir: context.appOutDir })
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
    {
      from: "../opencode/bin/reset-opencode.ps1",
      to: "reset-opencode.ps1",
    },
    ...(process.platform === "win32"
      ? [
          {
            from: "../opencode/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node",
            to: "native/canvas/skia.win32-x64-msvc.node",
          },
          {
            from: "build/updater-helper/win-x64/",
            to: "updater-helper/",
            filter: ["OpenCode.UpdaterHelper.exe"],
          },
        ]
      : []),
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "OpenCode",
    schemes: ["opencode"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signAndEditExecutable: shouldEditWindowsExecutable,
    ...(shouldUseWindowsSignScript
      ? {
          signtoolOptions: {
            sign: signWindows,
          },
        }
      : {}),
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: false,
    include: "resources/installer.nsh",
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const base = getBase()

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId: "ai.opencode.desktop.dev",
        productName: "OpenCode Dev",
        rpm: { packageName: "opencode-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: "ai.opencode.desktop.beta",
        productName: "OpenCode Beta",
        protocols: { name: "OpenCode Beta", schemes: ["opencode"] },
        publish: { provider: "github", owner: "anomalyco", repo: "opencode-beta", channel: "latest" },
        rpm: { packageName: "opencode-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "ai.opencode.desktop",
        productName: "OpenCode",
        protocols: { name: "OpenCode", schemes: ["opencode"] },
        publish: { provider: "github", owner: "anomalyco", repo: "opencode", channel: "latest" },
        rpm: { packageName: "opencode" },
      }
    }
  }
}

export default getConfig()
