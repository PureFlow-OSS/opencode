import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __OPENCODE__?: {
      updaterEnabled?: boolean
      betaTester?: boolean
      betaUserName?: string | null
      deepLinks?: string[]
    }
  }
}

