import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Part, UserMessage } from "@opencode-ai/sdk/v2/client"
import { filterCompletedCompactionUserMessages } from "./compaction-visibility"

const user = (id: string) =>
  ({
    id,
    sessionID: "s1",
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-4.1" },
  }) as UserMessage

const assistant = (input: { id: string; parentID: string; summary?: boolean; completed?: boolean; error?: unknown }) =>
  ({
    id: input.id,
    sessionID: "s1",
    role: "assistant",
    parentID: input.parentID,
    modelID: "gpt-4.1",
    providerID: "openai",
    summary: input.summary,
    error: input.error,
    cost: 0,
    time: { created: 1, ...(input.completed ? { completed: 2 } : {}) },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }) as AssistantMessage

const compaction = (messageID: string) =>
  ({
    id: `${messageID}-c1`,
    sessionID: "s1",
    messageID,
    type: "compaction",
    auto: false,
  }) as Part

describe("filterCompletedCompactionUserMessages", () => {
  test("hides successful compaction turns", () => {
    const u1 = user("u1")
    const u2 = user("u2")
    const result = filterCompletedCompactionUserMessages({
      userMessages: [u1, u2],
      messages: [u1, assistant({ id: "a1", parentID: "u1", summary: true, completed: true }), u2] as Message[],
      parts: { u1: [compaction("u1")] },
    })

    expect(result.map((item) => item.id)).toEqual(["u2"])
  })

  test("keeps failed compaction turns visible", () => {
    const u1 = user("u1")
    const result = filterCompletedCompactionUserMessages({
      userMessages: [u1],
      messages: [u1, assistant({ id: "a1", parentID: "u1", summary: true, error: { message: "boom" } })] as Message[],
      parts: { u1: [compaction("u1")] },
    })

    expect(result.map((item) => item.id)).toEqual(["u1"])
  })
})
