import { Injectable } from "@angular/core"

type ReleaseRecord = {
  id: string
  version: string
  channel: string
  zipName: string
  zipSha256: string
  zipSize: number
  notes?: string | null
  promoted: boolean
  positiveCount: number
  totalCount: number
  createdAt: string
  promotedAt?: string | null
}

type FeedbackRecord = {
  id: string
  text: string
  category: string
  userName: string
  appVersion?: string | null
  platform?: string | null
  attachments: FeedbackAttachment[]
  createdAt: string
}

type FeedbackAttachment = {
  name: string
  type: string
  dataUrl: string
  image: boolean
}

type ModelCard = {
  model: string
  context?: number | null
  output?: number | null
  temperature?: boolean | null
  reasoning?: boolean | null
  reasoningVariants?: string[] | null
  defaultReasoningVariant?: string | null
  documentVision?: boolean
  documentVisionNative?: boolean
  visible?: boolean | null
  price?: { input?: number | null; output?: number | null } | null
  modalities?: { input?: string[]; output?: string[] } | null
  source?: string
  config?: {
    pattern?: string | null
    context?: number | null
    output?: number | null
    temperature?: boolean | null
    reasoning?: boolean | null
    reasoningVariants?: string[] | null
    defaultReasoningVariant?: string | null
    documentVision?: boolean | null
    documentVisionNative?: boolean | null
    modalities?: { input?: string[]; output?: string[] } | null
  } | null
  liteLLM?: {
    name: string
    object?: string | null
    created?: number | null
    ownedBy?: string | null
    mode?: string | null
    provider?: string | null
    providerSpecificEntry?: string | null
    maxInputTokens?: number | null
    maxOutputTokens?: number | null
    inputCostPerMillionTokens?: number | null
    outputCostPerMillionTokens?: number | null
    supportsReasoning?: boolean | null
    modalities?: { input?: string[]; output?: string[] } | null
  } | null
}

type ModelCardsResponse = {
  version: string
  isBeta: boolean
  generatedAt: string
  aifactory?: {
    models?: ModelCard[]
    model_visibility?: Array<{ pattern?: string | null; visible?: boolean | null }>
  } | null
}

export type ModelSettings = {
  context?: number | null
  output?: number | null
  temperature?: boolean | null
  reasoning?: boolean | null
  reasoning_variants?: string[] | null
  default_reasoning_variant?: string | null
  document_vision?: boolean | null
  document_vision_native?: boolean | null
  visible?: boolean | null
  input_modalities?: string[]
  output_modalities?: string[]
}

export type McpConfig = {
  type: "local" | "remote"
  enabled?: boolean
  timeout?: number
  environment?: Record<string, string>
  command?: string[]
  url?: string
  headers?: Record<string, string>
  oauth?: { clientId?: string; clientSecret?: string; scope?: string; redirectUri?: string }
  auth?: { type: "pat"; label?: string; description?: string; placeholder?: string; header?: string; prefix?: string }
}

type ReleaseStatus = {
  releases: ReleaseRecord[]
  normalStopped: boolean
  betaUserCount: number
  betaPositiveThreshold: number
  betaRelease?: ReleaseRecord | null
  normalRelease?: ReleaseRecord | null
  betaFeedVersion?: string | null
  normalFeedVersion?: string | null
}

@Injectable({ providedIn: "root" })
export class ApiService {
  async readJson<T>(response: Response) {
    if (!response.ok) throw new Error(await response.text())
    return response.json() as Promise<T>
  }

  async listReleases() {
    return this.readJson<ReleaseRecord[]>(await fetch("/opencode/admin/releases", { cache: "no-store" }))
  }

  async listReleaseStatus() {
    return this.readJson<ReleaseStatus>(await fetch("/opencode/admin/releases/status", { cache: "no-store" }))
  }

  async uploadRelease(payload: { archive: File; notes?: string }) {
    const form = new FormData()
    form.set("archive", payload.archive)
    if (payload.notes) form.set("notes", payload.notes)
    return this.readJson<ReleaseRecord>(
      await fetch("/opencode/admin/releases/upload", { method: "POST", body: form }),
    )
  }

  async promoteRelease(id: string) {
    return this.readJson<ReleaseRecord>(await fetch(`/opencode/admin/releases/${id}/promote`, { method: "POST" }))
  }

  async stopNormalChannel() {
    return this.readJson<{ normalStopped: boolean }>(await fetch("/opencode/admin/releases/normal/stop", { method: "POST" }))
  }

  async clearNormalChannel() {
    return this.readJson<{ normalStopped: boolean }>(await fetch("/opencode/admin/releases/normal/clear", { method: "POST" }))
  }

  async listFeedback() {
    const items = await this.readJson<
      Array<{
        id: number
        text: string
        category: string
        beta_sentiment: string | null
        user_name: string | null
        app_version: string | null
        platform: string | null
        attachments: string | null
        created_at: string
      }>
    >(await fetch("/opencode/feedback", { cache: "no-store" }))

    return items.map((item) => ({
      id: String(item.id),
      text: item.text,
      category: item.category.trim().toLowerCase(),
      betaSentiment: item.beta_sentiment?.trim().toLowerCase() ?? null,
      userName: item.user_name?.trim() || "",
      appVersion: item.app_version,
      platform: item.platform,
      attachments: parseFeedbackAttachments(item.attachments),
      createdAt: item.created_at,
    }))
  }

  async createFeedback(payload: { channel: string; releaseId?: string; userName?: string; userEmail?: string; rating: string; message: string }) {
    return fetch("/opencode/admin/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  }

  async listModelCards(channel: "stable" | "beta" = "stable") {
    return this.readJson<ModelCardsResponse>(await fetch(`/opencode/admin/modelcards?channel=${channel}`, { cache: "no-store" }))
  }

  async saveModelSettings(model: string, channel: "stable" | "beta", settings: ModelSettings) {
    return this.readJson<ModelSettings>(await fetch(`/opencode/admin/model-settings?channel=${channel}&model=${encodeURIComponent(model)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    }))
  }

  async resetModelSettings(model: string, channel: "stable" | "beta") {
    const response = await fetch(`/opencode/admin/model-settings?channel=${channel}&model=${encodeURIComponent(model)}`, { method: "DELETE" })
    if (response.status === 404) throw new Error(`No exact ${channel} override exists for ${model}`)
    if (!response.ok) throw new Error(await response.text())
  }

  async listMcps(channel: "normal" | "beta") {
    return this.readJson<Record<string, McpConfig>>(await fetch(`/opencode/admin/mcp?channel=${channel}`))
  }

  async saveMcp(channel: "normal" | "beta", name: string, config: McpConfig) {
    return this.readJson<{ name: string; config: McpConfig }>(
      await fetch(`/opencode/admin/mcp/${encodeURIComponent(name)}?channel=${channel}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      }),
    )
  }

  async deleteMcp(channel: "normal" | "beta", name: string) {
    const response = await fetch(`/opencode/admin/mcp/${encodeURIComponent(name)}?channel=${channel}`, { method: "DELETE" })
    if (!response.ok) throw new Error(await response.text())
  }
}

function parseFeedbackAttachments(value: string | null): FeedbackAttachment[] {
  if (!value) return []
  try {
    const attachments: unknown = JSON.parse(value)
    if (!Array.isArray(attachments)) return []
    return attachments.flatMap((attachment) => {
      if (!attachment || typeof attachment !== "object") return []
      const value = attachment as { name?: unknown; type?: unknown; data?: unknown }
      if (typeof value.name !== "string" || typeof value.type !== "string" || typeof value.data !== "string") return []
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) return []
      return [{
        name: value.name,
        type: value.type,
        dataUrl: `data:${value.type};base64,${value.data}`,
        image: value.type.startsWith("image/"),
      }]
    })
  } catch {
    return []
  }
}
