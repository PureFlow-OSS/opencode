import { describe, expect, test } from "bun:test"
import { createSessionResumeRefresh } from "./session-resume"

function setup() {
  const state = { sessionID: "session" as string | undefined, connection: 1, healthy: true }
  const refreshed: string[] = []
  return {
    state,
    refreshed,
    visibility: createSessionResumeRefresh({
      snapshot: () => ({ ...state }),
      refresh: (id) => refreshed.push(id),
    }),
  }
}

describe("session resume refresh", () => {
  test("does not reload history on startup or repeated visible events", () => {
    const ctx = setup()
    ctx.visibility(true)
    ctx.visibility(true)
    expect(ctx.refreshed).toEqual([])
  })

  test("keeps a continuously connected session interactive across repeated switches", () => {
    const ctx = setup()
    for (let index = 0; index < 5; index++) {
      ctx.visibility(false)
      ctx.visibility(true)
    }
    expect(ctx.refreshed).toEqual([])
  })

  test("refreshes once after a background reconnection even when the stream is healthy again", () => {
    const ctx = setup()
    ctx.visibility(false)
    ctx.state.connection++
    ctx.visibility(false)
    ctx.visibility(true)
    ctx.visibility(true)
    expect(ctx.refreshed).toEqual(["session"])
  })

  test("refreshes when the stream stopped delivering heartbeats", () => {
    const ctx = setup()
    ctx.visibility(false)
    ctx.state.healthy = false
    ctx.visibility(true)
    expect(ctx.refreshed).toEqual(["session"])
  })

  test("refreshes when going into the background without a healthy connection", () => {
    const ctx = setup()
    ctx.state.healthy = false
    ctx.visibility(false)
    ctx.state.healthy = true
    ctx.visibility(true)
    expect(ctx.refreshed).toEqual(["session"])
  })

  test("does not reload a different session opened in the background", () => {
    const ctx = setup()
    ctx.visibility(false)
    ctx.state.connection++
    ctx.state.sessionID = "other"
    ctx.visibility(true)
    expect(ctx.refreshed).toEqual([])
  })

  test("does not request history for a new chat", () => {
    const ctx = setup()
    ctx.state.sessionID = undefined
    ctx.visibility(false)
    ctx.state.connection++
    ctx.visibility(true)
    expect(ctx.refreshed).toEqual([])
  })
})
