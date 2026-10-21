type Snapshot = {
  sessionID: string | undefined
  connection: number
  healthy: boolean
}

export function createSessionResumeRefresh(input: { snapshot: () => Snapshot; refresh: (sessionID: string) => void }) {
  let hidden: Snapshot | undefined

  return (visible: boolean) => {
    if (!visible) {
      hidden ??= input.snapshot()
      return
    }
    const previous = hidden
    hidden = undefined
    if (!previous) return
    const current = input.snapshot()
    if (!current.sessionID || current.sessionID !== previous.sessionID) return
    // An uninterrupted stream already delivered changes while the window was hidden.
    if (previous.healthy && current.healthy && previous.connection === current.connection) return
    input.refresh(current.sessionID)
  }
}
