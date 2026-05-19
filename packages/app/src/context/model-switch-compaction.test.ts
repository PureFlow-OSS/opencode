import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Provider } from "@opencode-ai/sdk/v2/client"
import { shouldCompactOnModelSwitch } from "./model-switch-compaction"

function assistant(total: number) {
  return {
    id: "a1",
    sessionID: "s1",
    role: "assistant",
    parentID: "u1",
    cost: 0,
    providerID: "openai",
    modelID: "gpt-4.1",
    mode: "default",
    time: { created: 1, completed: 2 },
    tokens: {
      input: total,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } as AssistantMessage
}

const providers = (limit: number) =>
  [
    {
      id: "openai",
      models: {
        "gpt-4.1": {
          id: "gpt-4.1",
          providerID: "openai",
          limit: { context: limit },
        },
      },
    },
  ] as unknown as Provider[]

describe("shouldCompactOnModelSwitch", () => {
  test("returns true when switching to a tighter model limit", () => {
    const result = shouldCompactOnModelSwitch({
      messages: [assistant(181_000)] as Message[],
      providers: providers(200_000),
      model: { providerID: "openai", modelID: "gpt-4.1" },
    })

    expect(result.shouldCompact).toBe(true)
  })

  test("returns false when the target model has enough headroom", () => {
    const result = shouldCompactOnModelSwitch({
      messages: [assistant(120_000)] as Message[],
      providers: providers(200_000),
      model: { providerID: "openai", modelID: "gpt-4.1" },
    })

    expect(result.shouldCompact).toBe(false)
  })

  test("falls back to conservative compaction when target limit is unknown", () => {
    const result = shouldCompactOnModelSwitch({
      messages: [assistant(72_000)] as Message[],
      providers: [
        {
          id: "openai",
          models: {
            "gpt-4.1": {
              id: "gpt-4.1",
              providerID: "openai",
              limit: { context: 0 },
            },
          },
        },
      ] as unknown as Provider[],
      model: { providerID: "openai", modelID: "gpt-4.1" },
    })

    expect(result.shouldCompact).toBe(true)
  })
})
