import { Component, inject } from "@angular/core"
import { injectMutation, injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService } from "./api.service"
import { formatDateTime } from "./format-date"

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
      <h2>Beta Feedback</h2>
      <p>Promote only after 50% positive beta feedback. Normal channel can be stopped here.</p>
      <div class="controls">
        <button type="button" class="secondary" (click)="refresh()">Refresh</button>
        <button type="button" class="secondary" (click)="stopNormal()" [disabled]="statusQuery.data()?.normalStopped">Stop normal</button>
        <button type="button" class="secondary" (click)="clearNormal()" [disabled]="!statusQuery.data()?.normalStopped">Clear stop</button>
      </div>
      <div class="list">
        @for (release of statusQuery.data()?.releases ?? []; track release.id) {
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
            @if (release.channel !== 'normal') {
              <button
                type="button"
                [disabled]="!canPromote(release)"
                (click)="promote(release.id)"
              >
                Promote to normal
              </button>
              @if (!canPromote(release)) {
                <small>
                  @if (isSuperseded(release)) {
                    A newer beta release is active.
                  } @else if (release.totalCount === 0) {
                    Waiting for beta feedback.
                  } @else {
                    Need {{ remainingPositive(release) }} more positive feedback item(s).
                  }
                </small>
              }
            }
          </section>
        }
      </div>
      <h3>Audit trail</h3>
      <div class="list">
        @for (event of auditQuery.data() ?? []; track event.id) {
          <section class="item">
            <div class="item-top">
              <strong>{{ event.action }}</strong>
              <span>{{ formatDateTime(event.createdAt) }}</span>
            </div>
            <p>{{ event.details }}</p>
            <small>{{ event.actor }} · {{ event.feedbackId }}</small>
          </section>
        }
      </div>
    </article>
  `,
  styleUrl: "./audit-panel.component.css",
})
export class AuditPanelComponent {
  readonly api = inject(ApiService)
  readonly formatDateTime = formatDateTime
  readonly statusQuery = injectQuery(() => ({
    queryKey: ["release-status"],
    queryFn: () => this.api.listReleaseStatus(),
  }))
  readonly auditQuery = injectQuery(() => ({
    queryKey: ["audit-trail"],
    queryFn: () => this.api.listAudit(),
  }))
  readonly promoteMutation = injectMutation(() => ({
    mutationFn: (id: string) => this.api.promoteRelease(id),
  }))
  readonly stopMutation = injectMutation(() => ({
    mutationFn: () => this.api.stopNormalChannel(),
  }))
  readonly clearMutation = injectMutation(() => ({
    mutationFn: () => this.api.clearNormalChannel(),
  }))

  constructor() {
    void this.refresh()
  }

  refresh() {
    void this.statusQuery.refetch()
    void this.auditQuery.refetch()
  }

  progress(release: ReleaseRecord) {
    if (release.totalCount === 0) return 0
    return Math.min(100, (release.positiveCount / release.totalCount) * 100)
  }

  canPromote(release: ReleaseRecord) {
    return !this.isSuperseded(release) && release.channel !== "normal" && release.totalCount > 0 && release.positiveCount * 2 >= release.totalCount
  }

  isSuperseded(release: ReleaseRecord) {
    const activeBetaVersion = this.statusQuery.data()?.betaFeedVersion
    return release.channel !== "normal" && !!activeBetaVersion && release.version !== activeBetaVersion
  }

  remainingPositive(release: ReleaseRecord) {
    return Math.max(0, Math.ceil(release.totalCount / 2) - release.positiveCount)
  }

  promote(id: string) {
    void this.promoteMutation.mutateAsync(id).then(() => this.refresh())
  }

  stopNormal() {
    void this.stopMutation.mutateAsync().then(() => this.statusQuery.refetch())
  }

  clearNormal() {
    void this.clearMutation.mutateAsync().then(() => this.statusQuery.refetch())
  }
}
