import { Component, inject } from "@angular/core"
import { ApiService } from "./api.service"

type ReleaseRecord = {
  id: string
  version: string
  channel: string
  positiveCount: number
  totalCount: number
  notes?: string | null
}

type AuditRecord = {
  id: string
  feedbackId: string
  actor: string
  action: string
  details: string
  createdAt: string
}

@Component({
  selector: "app-audit-panel",
  standalone: true,
  template: `
    <article class="card">
      <h2>Beta Promotion</h2>
      <p>Promote only after 50% positive beta feedback. Audit trail sits below.</p>
      <button type="button" class="secondary" (click)="refresh()">Refresh</button>
      <div class="list">
        @for (release of releases; track release.id) {
          <section class="item">
            <div class="item-top">
              <strong>{{ release.version }}</strong>
              <span>{{ release.channel }}</span>
            </div>
            <p>{{ release.positiveCount }}/{{ release.totalCount }} positive beta feedback</p>
            @if (release.notes) {
              <small>{{ release.notes }}</small>
            }
            <div class="progress">
              <span [style.width.%]="progress(release)"></span>
            </div>
            <button
              type="button"
              [disabled]="release.channel === 'normal' || release.totalCount === 0 || release.positiveCount * 2 < release.totalCount"
              (click)="promote(release.id)"
            >
              Promote to normal
            </button>
          </section>
        }
      </div>
      <h3>Audit trail</h3>
      <div class="list">
        @for (event of audit; track event.id) {
          <section class="item">
            <div class="item-top">
              <strong>{{ event.action }}</strong>
              <span>{{ event.createdAt }}</span>
            </div>
            <p>{{ event.details }}</p>
            <small>{{ event.actor }} · {{ event.feedbackId }}</small>
          </section>
        }
      </div>
    </article>
  `,
})
export class AuditPanelComponent {
  readonly api = inject(ApiService)
  releases: ReleaseRecord[] = []
  audit: AuditRecord[] = []

  constructor() {
    void this.refresh()
  }

  async refresh() {
    this.releases = await this.api.listReleases()
    this.audit = await this.api.listAudit()
  }

  progress(release: ReleaseRecord) {
    if (release.totalCount === 0) return 0
    return Math.min(100, (release.positiveCount / release.totalCount) * 100)
  }

  promote(id: string) {
    void this.api.promoteRelease(id).then(() => this.refresh())
  }
}
