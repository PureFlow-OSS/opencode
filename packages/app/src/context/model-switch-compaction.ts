import type { Message, Provider as ProviderInfo } from "@opencode-ai/sdk/v2/client"

const COMPACTION_HEADROOM = 20_000
const COMPACTION_USAGE_THRESHOLD = 0.9
const UNKNOWN_LIMIT_THRESHOLD = 50_000

function tokenTotal(message: Extract<Message, { role: "assistant" }>) {
  return (
    message.tokens.input +
    message.tokens.output +
    message.tokens.reasoning +
    message.tokens.cache.read +
    message.tokens.cache.write
  )
}

function lastAssistantWithTokens(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "assistant") continue
    if (tokenTotal(message) <= 0) continue
    return message
  }
}

export function shouldCompactOnModelSwitch(input: {
  messages: Message[]
  providers: ProviderInfo[]
  model: { providerID: string; modelID: string }
}) {
  const last = lastAssistantWithTokens(input.messages)
  if (!last) return { shouldCompact: false, total: 0, limit: undefined }

  const provider = input.providers.find((item) => item.id === input.model.providerID)
  const model = provider?.models[input.model.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(last)
  if (total <= 0) return { shouldCompact: false, total, limit }
  if (!limit) return { shouldCompact: total >= UNKNOWN_LIMIT_THRESHOLD, total, limit }

  const threshold = Math.max(Math.floor(limit * COMPACTION_USAGE_THRESHOLD), limit - COMPACTION_HEADROOM)
  return {
    shouldCompact: total >= threshold,
    total,
    limit,
  }
}
