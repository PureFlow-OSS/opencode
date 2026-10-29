import type { ServerReadyData } from "../../shared/ipc-contract"

export async function awaitMigrationCompleted(server: ServerReadyData, signal: AbortSignal) {
  const { OpenCode } = await import("@opencode/client/promise")
  const client = OpenCode.make({ baseUrl: server.url })

  while (true) {
    const status = await client.migration.v1.status({ signal }).catch((error) => {
      if (signal.aborted) throw signal.reason
      throw error
    })

    if (status.status === "completed") return

    if (status.status === "error") throw new Error(status.error)

    await wait(1_000, signal).catch((error) => {
      if (signal.aborted) throw signal.reason
      throw error
    })
  }
}

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)

    const timer = setTimeout(done, delay)
    signal.addEventListener("abort", done, { once: true })

    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)

      if (signal.aborted) reject(signal.reason)
      else resolve()
    }
  })
}
