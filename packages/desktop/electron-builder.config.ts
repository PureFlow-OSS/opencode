import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
// The Electron 42 packaging update briefly installed Linux launchers/icons under
// "opencode-desktop". Keep that hidden desktop entry around so existing GNOME/KDE
// pins still resolve after the canonical app id changes back to ai.opencode.desktop.
const legacyDesktopEntry = path.join(packageDir, "resources", "linux", "opencode-desktop.desktop")
const legacyDesktopEntryFpm = `${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (!hasSigningConfiguration()) return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

async function signWindowsOutput(configuration: { appOutDir: string }) {
  if (process.platform !== "win32") return
  if (!hasSigningConfiguration()) return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.appOutDir],
    { cwd: rootDir },
  )
}

function hasSigningConfiguration() {
  const keyVault =
    (process.env.AZURE_KEYVAULT_URL || process.env.KEYVAULT_URL) &&
    (process.env.AZURE_KEYVAULT_CLIENT_ID || process.env.AZURE_CLIENT_ID) &&
    (process.env.AZURE_KEYVAULT_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET) &&
    (process.env.AZURE_KEYVAULT_TENANT_ID || process.env.AZURE_TENANT_ID) &&
    (process.env.AZURE_KEYVAULT_CERT || process.env.CERT_ALIAS || process.env.CertificateName)
  const trustedSigning =
    process.env.AZURE_TRUSTED_SIGNING_ENDPOINT &&
    process.env.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME &&
    process.env.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE
  return Boolean(keyVault || trustedSigning)
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "prod"
})()
const outputDir = process.env.OPENCODE_ELECTRON_OUTPUT_DIR?.trim() || "dist"

const APP_IDS = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: "opencode-desktop-${os}-${arch}.${ext}",
  directories: {
    output: outputDir,
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.opencode.desktop" becomes
  // "ai.opencode.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*"],
  afterSign: async (context: { appOutDir: string }) => {
    await signWindowsOutput(context)
  },
  extraResources: [
    ...(process.platform === "win32"
      ? [
          {
            from: "../opencode/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node",
            to: "native/canvas/skia.win32-x64-msvc.node",
          },
          {
            from: "../opencode/node_modules/@napi-rs/canvas-win32-x64-msvc/icudtl.dat",
            to: "native/canvas/icudtl.dat",
          },
          {
            from: "../opencode/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
            to: "pdfjs/pdf.worker.mjs",
          },
          {
            from: "../opencode/node_modules/pdfjs-dist/legacy/build/pdf.mjs",
            to: "pdfjs/pdf.mjs",
          },
        ]
      : []),
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
    {
      from: "../opencode/bin/reset-opencode.ps1",
      to: "reset-opencode.ps1",
    },
    {
      from: "build/updater-helper/win-x64/",
      to: "updater-helper/",
      filter: ["OpenCode.UpdaterHelper.exe"],
    },
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
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    include: "resources/installer.nsh",
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "OpenCode Dev",
        rpm: { packageName: "opencode-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "OpenCode Beta",
        protocols: { name: "OpenCode Beta", schemes: ["opencode"] },
        publish: { provider: "github", owner: "anomalyco", repo: "opencode-beta", channel: "latest" },
        rpm: { packageName: "opencode-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "OpenCode",
        protocols: { name: "OpenCode", schemes: ["opencode"] },
        publish: { provider: "github", owner: "anomalyco", repo: "opencode", channel: "latest" },
        deb: { fpm: [legacyDesktopEntryFpm] },
        rpm: { packageName: "opencode", fpm: [legacyDesktopEntryFpm] },
      }
    }
  }
}

export default getConfig()
