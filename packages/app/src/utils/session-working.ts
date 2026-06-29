import type { Message, SessionStatus } from "@opencode-ai/sdk/v2/client"

export function sessionWorking(input: { messages?: Message[]; status?: SessionStatus }) {
  if (
    (input.messages ?? []).some((message) => message.role === "assistant" && typeof message.time.completed !== "number")
  ) {
    return true
  }
  if (!input.status || input.status.type === "idle") return false

  const lastUser = (input.messages ?? []).findLast((message) => message.role === "user")
  const lastAssistant = (input.messages ?? []).findLast(
    (message) => message.role === "assistant" && typeof message.time.completed === "number",
  )
  if (lastAssistant && (!lastUser || lastAssistant.time.created >= lastUser.time.created)) return false
  return true
}
