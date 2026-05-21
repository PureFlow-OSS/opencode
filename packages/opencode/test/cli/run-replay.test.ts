import { describe, expect, test } from "bun:test"
import { collectReplayBlockers, collectReplayItems } from "../../src/cli/cmd/run-replay"
import type { MessageV2 } from "../../src/session/message-v2"
import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2"

function userMessage(id: string, text: string): MessageV2.WithParts {
  return {
    info: {
      id: id as never,
      sessionID: "ses_1" as never,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "openai" as never, modelID: "gpt-5" as never },
    },
    parts: [
      {
        id: `${id}_text` as never,
        sessionID: "ses_1" as never,
        messageID: id as never,
        type: "text",
        text,
      },
    ],
  }
}

function assistantMessage(id: string): MessageV2.WithParts {
  return {
    info: {
      id: id as never,
      sessionID: "ses_1" as never,
      role: "assistant",
      time: { created: 2, completed: 3 },
      parentID: "usr_1" as never,
      modelID: "gpt-5" as never,
      providerID: "openai" as never,
      mode: "chat",
      agent: "build",
      path: { cwd: ".", root: "." },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [
      {
        id: `${id}_reasoning` as never,
        sessionID: "ses_1" as never,
        messageID: id as never,
        type: "reasoning",
        text: "plan",
        time: { start: 2, end: 3 },
      },
      {
        id: `${id}_text` as never,
        sessionID: "ses_1" as never,
        messageID: id as never,
        type: "text",
        text: "answer",
        time: { start: 3, end: 4 },
      },
    ],
  }
}

describe("run replay", () => {
  test("collects visible replay items in message order", () => {
    const items = collectReplayItems([userMessage("usr_1", "hello"), assistantMessage("ast_1")], {
      thinking: true,
    })

    expect(items).toEqual([
      { type: "user", text: "hello" },
      { type: "assistant-header", agent: "build", modelID: "gpt-5" },
      { type: "reasoning", text: "plan" },
      { type: "text", text: "answer" },
    ])
  })

  test("applies replay limit to newest messages only", () => {
    const items = collectReplayItems(
      [userMessage("usr_1", "first"), assistantMessage("ast_1"), userMessage("usr_2", "second")],
      {
        thinking: false,
        limit: 1,
      },
    )

    expect(items).toEqual([{ type: "user", text: "second" }])
  })

  test("collects pending blockers for the current session", () => {
    const permissions: PermissionRequest[] = [
      {
        id: "perm_1",
        sessionID: "ses_1",
        permission: "edit",
        patterns: ["src/**"],
        metadata: {},
        always: [],
      },
      {
        id: "perm_2",
        sessionID: "ses_2",
        permission: "read",
        patterns: ["docs/**"],
        metadata: {},
        always: [],
      },
    ]
    const questions: QuestionRequest[] = [
      {
        id: "que_1",
        sessionID: "ses_1",
        questions: [
          {
            header: "Mode",
            question: "Which mode?",
            options: [],
          },
          {
            header: "Color",
            question: "Which color?",
            options: [],
          },
        ],
      },
      {
        id: "que_2",
        sessionID: "ses_2",
        questions: [
          {
            header: "Ignore",
            question: "Other session",
            options: [],
          },
        ],
      },
    ]
    const blockers = collectReplayBlockers({
      sessionID: "ses_1",
      permissions,
      questions,
    })

    expect(blockers).toEqual([
      {
        type: "permission",
        id: "perm_1",
        permission: "edit",
        patterns: ["src/**"],
      },
      {
        type: "question",
        id: "que_1",
        header: "Mode",
        question: "Which mode?",
      },
      {
        type: "question",
        id: "que_1",
        header: "Color",
        question: "Which color?",
      },
    ])
  })
})
