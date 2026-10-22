import { readFileSync } from "node:fs"
import path from "node:path"
import { app } from "electron"
import type { Endpoint } from "@opencode/client/service"
import { cliBuildID } from "./cli-build"
import { serviceRegistrationFile } from "./service-registration"

// The main thread idles between showing the first window and evaluating the main bundle, waiting
// for the renderer's asset requests. That slot is long enough to find out whether a compatible
// background service is already running, so the renderer's first data request is not the first
// moment anyone asks. The probe only looks; a service that has to be started waits for the layers,
// which set the environment the CLI expects.
let probe: Promise<Endpoint | undefined> | undefined

let buildID: Promise<string> | undefined

export function startSidecarProbe() {
  if (!app.isPackaged) return
  const version = bundledVersion()

  if (!version) return
  buildID = cliBuildID(
    path.join(process.resourcesPath, process.platform === "win32" ? "opencode-cli.exe" : "opencode-cli"),
  )
  probe = import("@opencode/client/service")
    .then(async ({ Service }) =>
      Service.discover({
        version,
        buildID: await buildID,
        file: serviceRegistrationFile({
          state: process.env.XDG_STATE_HOME ?? path.join(app.getPath("home"), ".local", "state"),
          channel: process.env.OPENCODE_DESKTOP_SERVER_CHANNEL ?? import.meta.env.OPENCODE_CLI_CHANNEL ?? "latest",
        }),
      }),
    )
    .catch(() => undefined)
}

export async function sidecarProbe(expectedBuildID?: string) {
  if (expectedBuildID !== undefined && expectedBuildID !== (await buildID?.catch(() => undefined))) return undefined

  return probe ?? undefined
}

function bundledVersion() {
  try {
    return readFileSync(path.join(process.resourcesPath, "opencode-cli.version"), "utf8").trim()
  } catch {
    return ""
  }
}
