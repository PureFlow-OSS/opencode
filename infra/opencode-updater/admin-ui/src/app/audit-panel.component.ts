import { Component, inject } from "@angular/core"
import { injectMutation, injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService } from "./api.service"

type ReleaseRecord = {
  id: string
  version: string
  channel: string
  positiveCount: number
  totalCount: number
  notes?: string | null
}

@Component({
  selector: "app-audit-panel",
  standalone: true,
  template: `
    <article class="card">
      <h2>Beta uploads</h2>
      <p>Promote releases step by step: beta to AI-Gilde, then AI-Gilde to normal. Each step requires positive feedback from the matching tester group. Normal channel can be stopped here.</p>
      <div class="controls">
        <button type="button" class="secondary" (click)="refresh()">Refresh</button>
        <button type="button" class="secondary" (click)="stopNormal()" [disabled]="statusQuery.data()?.normalStopped">Stop normal</button>
        <button type="button" class="secondary" (click)="clearNormal()" [disabled]="!statusQuery.data()?.normalStopped">Clear stop</button>
      </div>
      <div class="list">
        @if ((statusQuery.data()?.releases ?? []).length === 0) {
          <section class="item empty">
            <strong>No beta uploads yet</strong>
            <p>Upload a ZIP to make a beta release available for review and promotion.</p>
          </section>
        }
        @for (release of statusQuery.data()?.releases ?? []; track release.id) {
          <section class="item">
            <div class="item-top">
              <strong>{{ release.version }}</strong>
              <span>{{ release.channel }}</span>
            </div>
            <p>{{ release.positiveCount }}/{{ threshold(release) }} positive feedback required</p>
            <small>{{ release.totalCount }} feedback item(s) submitted</small>
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
                Promote to {{ nextChannel(release) }}
              </button>
              @if (!canPromote(release)) {
                <small>
                  @if (isSuperseded(release)) {
                    A newer release is active in this channel.
                  } @else if (release.totalCount === 0) {
                    Waiting for feedback.
                  } @else {
                    Need {{ remainingPositive(release) }} more positive feedback item(s).
                  }
                </small>
              }
            }
          </section>
        }
      </div>
    </article>
  `,
  styleUrl: "./audit-panel.component.css",
})
export class AuditPanelComponent {
  readonly api = inject(ApiService)
  readonly statusQuery = injectQuery(() => ({
    queryKey: ["release-status"],
    queryFn: () => this.api.listReleaseStatus(),
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
  }

  get betaPositiveThreshold() {
    return this.statusQuery.data()?.betaPositiveThreshold ?? 1
  }

  threshold(release: ReleaseRecord) {
    return release.channel === "ai-gilde" ? (this.statusQuery.data()?.aiGildePositiveThreshold ?? 1) : this.betaPositiveThreshold
  }

  nextChannel(release: ReleaseRecord) {
    return release.channel === "beta" ? "AI-Gilde" : "normal"
  }

  progress(release: ReleaseRecord) {
    return Math.min(100, (release.positiveCount / this.threshold(release)) * 100)
  }

  canPromote(release: ReleaseRecord) {
    return !this.isSuperseded(release) && release.channel !== "normal" && release.positiveCount >= this.threshold(release)
  }

  isSuperseded(release: ReleaseRecord) {
    if (release.channel !== "beta" && release.channel !== "ai-gilde") return false
    const activeVersion = release.channel === "ai-gilde" ? this.statusQuery.data()?.aiGildeFeedVersion : this.statusQuery.data()?.betaFeedVersion
    return !!activeVersion && release.version !== activeVersion
  }

  remainingPositive(release: ReleaseRecord) {
    return Math.max(0, this.threshold(release) - release.positiveCount)
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
