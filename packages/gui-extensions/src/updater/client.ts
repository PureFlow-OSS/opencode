import type { AppAdapter } from "electron-updater/out/AppAdapter.js"
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor.js"
import { NsisUpdater } from "electron-updater"

class WindowsUpdater extends NsisUpdater {
  // Supplying a custom AppAdapter leaves electron-updater's httpExecutor null, so both update checks and downloads
  // need this explicit Electron-backed executor.
  httpExecutor = new ElectronHttpExecutor((authInfo, callback) => this.emit("login", authInfo, callback))
}

export function windowsUpdater(adapter: AppAdapter) {
  return new WindowsUpdater(null, adapter)
}
