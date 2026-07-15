import Store from "electron-store"
import { app } from "electron"
import { renameSync } from "node:fs"
import { join } from "node:path"

import { SETTINGS_STORE } from "./constants"

const cache = new Map<string, Store>()

// We cannot instantiate the electron-store at module load time because
// module import hoisting causes this to run before app.setPath("userData", ...)
// in index.ts has executed, which would result in files being written to the default directory
// (e.g. bad: %APPDATA%\@opencode-ai\desktop-electron\opencode.settings vs good: %APPDATA%\ai.opencode.desktop.dev\opencode.settings).
export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const next = loadStore(name)
  cache.set(name, next)
  return next
}

function loadStore(name: string) {
  try {
    return new Store({ name, fileExtension: "", accessPropertiesByDotNotation: false })
  } catch (error) {
    const source = join(app.getPath("userData"), name)
    const backup = `${source}.corrupt-${Date.now()}`
    renameSync(source, backup)
    return new Store({ name, fileExtension: "", accessPropertiesByDotNotation: false })
  }
}
