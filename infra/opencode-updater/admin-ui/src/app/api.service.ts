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
  channel: string
  releaseId?: string | null
  userName?: string | null
  userEmail?: string | null
  rating: string
  message: string
  createdAt: string
}

type AuditRecord = {
  id: string
  feedbackId: string
  actor: string
  action: string
  details: string
  createdAt: string
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
    return this.readJson<ReleaseRecord[]>(await fetch("/opencode/admin/releases"))
  }

  async listReleaseStatus() {
    return this.readJson<ReleaseStatus>(await fetch("/opencode/admin/releases/status"))
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
    return this.readJson<FeedbackRecord[]>(await fetch("/opencode/feedback"))
  }

  async createFeedback(payload: { channel: string; releaseId?: string; userName?: string; userEmail?: string; rating: string; message: string }) {
    return fetch("/opencode/admin/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  }

  async listAudit() {
    return this.readJson<AuditRecord[]>(await fetch("/opencode/admin/audit"))
  }
}
