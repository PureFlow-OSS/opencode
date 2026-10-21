import type { ProviderListResponse } from "@/runtime/server/types"
import { popularProviders } from "./order"

// ChatGPT token sharing and both Codex sign-in methods belong to the OpenAI integration.
export function isAvailableProvider(id: string) {
  return popularProviders.includes(id)
}

export function availableProviderCatalog(catalog: ProviderListResponse): ProviderListResponse {
  return {
    all: new Map([...catalog.all].filter(([id]) => isAvailableProvider(id))),
    connected: catalog.connected.filter(isAvailableProvider),
    default: Object.fromEntries(Object.entries(catalog.default).filter(([id]) => isAvailableProvider(id))),
  }
}
