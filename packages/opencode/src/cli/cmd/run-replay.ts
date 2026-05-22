import type { Message, Part, PermissionRequest, QuestionRequest, ToolPart } from "@opencode-ai/sdk/v2"

type WithParts = {
  info: Message
  parts: Part[]
}

export type ReplayItem =
  | {
      type: "assistant-header"
      agent: string
      modelID: string
    }
  | {
      type: "user"
      text: string
    }
  | {
      type: "text"
      text: string
    }
  | {
      type: "reasoning"
      text: string
    }
  | {
      type: "tool"
      part: ToolPart
    }
  | {
      type: "error"
      text: string
    }

export type ReplayBlocker =
  | {
      type: "permission"
      id: string
      permission: string
      patterns: string[]
    }
  | {
      type: "question"
      id: string
      header: string
      question: string
    }

export type ReplaySnapshot = {
  assistantMessageIDs: string[]
  partIDs: string[]
  partText: Record<string, string>
}

function userText(message: WithParts) {
  return message.parts
    .filter((part): part is Extract<WithParts["parts"][number], { type: "text" }> => part.type === "text")
    .filter((part) => !part.synthetic && !part.ignored)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
}

function assistantItems(message: WithParts, thinking: boolean) {
  const items: ReplayItem[] = []
  for (const part of message.parts) {
    if (part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")) {
      items.push({ type: "tool", part })
      continue
    }

    if (part.type === "text" && part.time?.end) {
      const text = part.text.trim()
      if (text) items.push({ type: "text", text })
      continue
    }

    if (part.type === "reasoning" && part.time?.end && thinking) {
      const text = part.text.trim()
      if (text) items.push({ type: "reasoning", text })
    }
  }

  if (message.info.role === "assistant" && message.info.error) {
    let text = String(message.info.error.name)
    if ("data" in message.info.error && message.info.error.data && "message" in message.info.error.data) {
      text = String(message.info.error.data.message)
    }
    items.push({ type: "error", text })
  }

  return items
}

export function collectReplayItems(
  messages: WithParts[],
  input: {
    thinking: boolean
    limit?: number
  },
) {
  const source = typeof input.limit === "number" ? messages.slice(-input.limit) : messages
  const items: ReplayItem[] = []

  for (const message of source) {
    if (message.info.role === "user") {
      const text = userText(message)
      if (text) items.push({ type: "user", text })
      continue
    }

    const next = assistantItems(message, input.thinking)
    if (next.length === 0) continue
    items.push({
      type: "assistant-header",
      agent: message.info.agent,
      modelID: message.info.modelID,
    })
    items.push(...next)
  }

  return items
}

export function collectReplaySnapshot(
  messages: WithParts[],
  input: {
    thinking: boolean
    limit?: number
  },
): ReplaySnapshot {
  const source = typeof input.limit === "number" ? messages.slice(-input.limit) : messages
  const assistantMessageIDs: string[] = []
  const partIDs: string[] = []
  const partText: Record<string, string> = {}

  for (const message of source) {
    if (message.info.role !== "assistant") continue

    const assistant = assistantItems(message, input.thinking)
    if (assistant.length === 0) continue
    assistantMessageIDs.push(message.info.id)

    for (const item of assistant) {
      if (item.type !== "tool") continue
      partIDs.push(item.part.id)
    }

    for (const part of message.parts) {
      if (part.type === "text" && part.time?.end) {
        partIDs.push(part.id)
        partText[part.id] = part.text
        continue
      }

      if (part.type === "reasoning" && part.time?.end && input.thinking) {
        partIDs.push(part.id)
        partText[part.id] = part.text
      }
    }
  }

  return { assistantMessageIDs, partIDs, partText }
}

export function collectReplayBlockers(input: {
  sessionID: string
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
}) {
  const blockers: ReplayBlocker[] = []

  for (const permission of input.permissions) {
    if (permission.sessionID !== input.sessionID) continue
    blockers.push({
      type: "permission",
      id: permission.id,
      permission: permission.permission,
      patterns: permission.patterns,
    })
  }

  for (const question of input.questions) {
    if (question.sessionID !== input.sessionID) continue
    for (const item of question.questions) {
      blockers.push({
        type: "question",
        id: question.id,
        header: item.header,
        question: item.question,
      })
    }
  }

  return blockers
}
