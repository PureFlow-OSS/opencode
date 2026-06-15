import { Component, inject } from "@angular/core"
import { ApiService } from "./api.service"

type ReleaseRecord = {
  id: string
  version: string
  channel: string
  positiveCount: number
  totalCount: number
}

type AuditRecord = {
  id: string
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
      <h2>Promotion & Audit</h2>
      <p>Review release health and the full feedback trail.</p>
      <button type="button" (click)="refresh()">Refresh</button>
      <div class="list">
        @for (release of releases; track release.id) {
          <section class="item">
            <strong>{{ release.version }}</strong>
            <span>{{ release.channel }}</span>
            <p>{{ release.positiveCount }}/{{ release.totalCount }} positive</p>
            <button type="button" [disabled]="release.channel === 'normal' || release.totalCount === 0 || release.positiveCount * 2 < release.totalCount" (click)="promote(release.id)">
              Promote
            </button>
          </section>
        }
      </div>
      <div class="list">
        @for (event of audit; track event.id) {
          <section class="item">
            <strong>{{ event.action }}</strong>
            <p>{{ event.details }}</p>
            <small>{{ event.actor }} · {{ event.createdAt }}</small>
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

  promote(id: string) {
    void this.api.promoteRelease(id).then(() => this.refresh())
  }
}
