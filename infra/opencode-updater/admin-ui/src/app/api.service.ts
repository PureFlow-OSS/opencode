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

@Injectable({ providedIn: "root" })
export class ApiService {
  async listReleases() {
    return (await fetch("/opencode/admin/releases")).json() as Promise<ReleaseRecord[]>
  }

  async uploadRelease(payload: { version: string; zipName?: string; zipSha256?: string; zipSize: number; notes?: string }) {
    return fetch("/opencode/admin/releases/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  }

  async promoteRelease(id: string) {
    return fetch(`/opencode/admin/releases/${id}/promote`, { method: "POST" })
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
