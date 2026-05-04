import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { sessionWorking } from "./session-working"

const user = (created: number): Message => ({
  id: `usr_${created}`,
  sessionID: "ses_1",
  role: "user",
  time: { created },
  agent: "build",
  model: { providerID: "anthropic", modelID: "claude" },
})

const assistant = (created: number, completed?: number): Message => ({
  id: `msg_${created}`,
  sessionID: "ses_1",
  role: "assistant",
  time: completed === undefined ? { created } : { created, completed },
  parentID: "usr_1",
  modelID: "claude",
  providerID: "anthropic",
  mode: "build",
  agent: "build",
  path: { cwd: "/tmp", root: "/tmp" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
})

describe("sessionWorking", () => {
  test("keeps busy while assistant is incomplete", () => {
    expect(sessionWorking({ messages: [user(1), assistant(2)], status: { type: "busy" } })).toBe(true)
  })

  test("ignores stale busy after assistant completed current turn", () => {
    expect(sessionWorking({ messages: [user(1), assistant(2, 3)], status: { type: "busy" } })).toBe(false)
  })

  test("keeps busy before assistant starts current turn", () => {
    expect(sessionWorking({ messages: [user(1)], status: { type: "busy" } })).toBe(true)
  })
})
