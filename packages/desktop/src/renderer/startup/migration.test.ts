import { afterEach, describe, expect, test } from "bun:test"
import type { MigrationV1StatusOutput } from "@opencode/client/promise"
import type { ServerReadyData } from "../../shared/ipc-contract"
import { awaitMigrationCompleted } from "./migration"

const servers: ReturnType<typeof Bun.serve>[] = []

function server(statuses: MigrationV1StatusOutput[]) {
  let request = 0
  const requested: MigrationV1StatusOutput[] = []
  const local = Bun.serve({
    port: 0,
    fetch(served) {
      if (new URL(served.url).pathname !== "/api/experimental/migration/v1")
        return new Response("not found", { status: 404 })

      const index = request++
      const status = statuses[Math.min(index, statuses.length - 1)]
      requested.push(status)
      return Response.json(status)
    },
  })

  return { local, requested: () => requested }
}

afterEach(() => {
  for (const each of servers.splice(0)) each.stop(true)
})

describe("renderer migration gating", () => {
  test("returns immediately when the migration is already completed", async () => {
    const local = server([{ status: "completed" }])
    servers.push(local.local)

    await awaitMigrationCompleted(serverData(local.local.url.toString()), new AbortController().signal)
    expect(local.requested()).toEqual([{ status: "completed" }])
  })

  test("waits through a running migration until it completes", async () => {
    const local = server([
      { status: "required" },
      { status: "running", progress: { label: "Migrating sessions" } },
      { status: "completed" },
    ])
    servers.push(local.local)

    await awaitMigrationCompleted(serverData(local.local.url.toString()), new AbortController().signal)
    expect(local.requested()).toEqual([
      { status: "required" },
      { status: "running", progress: { label: "Migrating sessions" } },
      { status: "completed" },
    ])
  })

  test("throws the migration error", async () => {
    const local = server([{ status: "error", error: "Cannot migrate sessions" }])
    servers.push(local.local)

    await expect(
      awaitMigrationCompleted(serverData(local.local.url.toString()), new AbortController().signal),
    ).rejects.toThrow("Cannot migrate sessions")
  })

  test("stops polling when the caller aborts", async () => {
    const firstRequest = Promise.withResolvers<void>()
    const local = Bun.serve({
      port: 0,
      fetch(served) {
        firstRequest.resolve()
        return Response.json({ status: "running", progress: { label: "Migrating sessions" } })
      },
    })
    servers.push(local)

    const abort = new AbortController()
    const pending = awaitMigrationCompleted(serverData(local.url.toString()), abort.signal)
    await firstRequest.promise
    abort.abort()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })
})

function serverData(url: string): ServerReadyData {
  return { url }
}
