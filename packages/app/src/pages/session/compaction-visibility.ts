import type { Message, Part, UserMessage } from "@opencode-ai/sdk/v2/client"

export function filterCompletedCompactionUserMessages(input: {
  userMessages: UserMessage[]
  messages: Message[]
  parts: Record<string, Part[] | undefined>
}) {
  return input.userMessages.filter((message) => {
    const compaction = input.parts[message.id]?.some((part) => part.type === "compaction")
    if (!compaction) return true

    return !input.messages.some(
      (item) =>
        item.role === "assistant" &&
        item.parentID === message.id &&
        item.summary === true &&
        !!item.time.completed &&
        !item.error,
    )
  })
}
