import type { Message, Part, ToolPart } from "@opencode-ai/sdk/v2"

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
