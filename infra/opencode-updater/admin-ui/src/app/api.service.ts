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
}

@Injectable({ providedIn: "root" })
export class ApiService {
  async listReleases() {
    return (await fetch("/opencode/admin/releases")).json() as Promise<ReleaseRecord[]>
  }

  async listReleaseStatus() {
    return (await fetch("/opencode/admin/releases/status")).json() as Promise<ReleaseStatus>
  }

  async uploadRelease(payload: { archive: File; notes?: string }) {
    const form = new FormData()
    form.set("archive", payload.archive)
    if (payload.notes) form.set("notes", payload.notes)
    return fetch("/opencode/admin/releases/upload", { method: "POST", body: form })
  }

  async promoteRelease(id: string) {
    return fetch(`/opencode/admin/releases/${id}/promote`, { method: "POST" })
  }

  async stopNormalChannel() {
    return fetch("/opencode/admin/releases/normal/stop", { method: "POST" })
  }

  async clearNormalChannel() {
    return fetch("/opencode/admin/releases/normal/clear", { method: "POST" })
  }

  async listFeedback() {
    return (await fetch("/opencode/admin/feedback")).json() as Promise<FeedbackRecord[]>
  }

  async createFeedback(payload: { channel: string; releaseId?: string; userName?: string; userEmail?: string; rating: string; message: string }) {
    return fetch("/opencode/admin/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  }

  async listAudit() {
    return (await fetch("/opencode/admin/audit")).json() as Promise<AuditRecord[]>
  }
}
