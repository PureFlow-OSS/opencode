import { Component, inject, signal } from "@angular/core"
import { injectMutation, injectQuery, injectQueryClient } from "@tanstack/angular-query-experimental"
import { ApiService, ReleaseChannel, ReleaseChannelStatus } from "./api.service"

@Component({
  selector: "app-audit-panel",
  standalone: true,
  template: `
    <article class="card">
      <h2>Releases</h2>
      <p>Promote manually from beta to AI-Gilde, then from AI-Gilde to normal.</p>
      <div class="controls">
        <button type="button" class="secondary" (click)="refresh()" [disabled]="statusQuery.isFetching()">Refresh</button>
      </div>
      @if (statusQuery.isPending()) {
        <p class="status-text" role="status">Loading release channels…</p>
      }
      @if (statusQuery.isError()) {
        <p class="status-text error" role="alert">Release status unavailable: {{ queryError() }}</p>
      }
      <div class="list">
        @if (statusQuery.isSuccess() && channels().length === 0) {
          <section class="item empty">
            <strong>No release channels yet</strong>
            <p>Upload a ZIP to publish the first beta release.</p>
          </section>
        }
        @for (channel of channels(); track channel.channel) {
          <section class="item">
            <div class="item-top">
              <strong>{{ channelLabel(channel.channel) }}</strong>
              <span>{{ channel.version ?? channel.release?.version ?? "No release yet" }}</span>
            </div>
            <p>{{ deliveryText(channel) }}</p>
            @if (channel.release?.notes) {
              <small>{{ channel.release.notes }}</small>
            }
            <div class="channel-actions">
              @if (channel.channel !== 'normal') {
                <button
                  type="button"
                  [disabled]="!canPromote(channel) || busy()"
                  (click)="promote(channel)"
                >
                  @if (promoting() === channel.channel) {
                    Promoting…
                  } @else {
                    Promote {{ channelLabel(channel.channel) }} to {{ nextChannelLabel(channel.channel) }}
                  }
                </button>
              }
              <button
                type="button"
                class="secondary"
                [disabled]="!canStop(channel) || busy()"
                (click)="stop(channel)"
              >
                @if (stopping() === channel.channel) {
                  Stopping…
                } @else {
                  Stop {{ channelLabel(channel.channel) }}
                }
              </button>
              <button
                type="button"
                class="secondary"
                [disabled]="!channel.stopped || !channel.filesAvailable || busy()"
                (click)="resume(channel)"
              >
                @if (resuming() === channel.channel) {
                  Resuming…
                } @else {
                  Resume {{ channelLabel(channel.channel) }}
                }
              </button>
            </div>
            @if (channel.channel !== 'normal' && !canPromote(channel)) {
              <small>{{ promotionHint(channel) }}</small>
            }
          </section>
        }
      </div>
      @if (mutationStatus()) {
        <p class="status-text" role="status">{{ mutationStatus() }}</p>
      }
      @if (mutationError()) {
        <p class="status-text error" role="alert">{{ mutationError() }}</p>
      }
    </article>
  `,
  styleUrl: "./audit-panel.component.css",
})
export class AuditPanelComponent {
  readonly api = inject(ApiService)
  readonly queryClient = injectQueryClient()
  readonly statusQuery = injectQuery(() => ({
    queryKey: ["release-status"],
    queryFn: () => this.api.listReleaseStatus(),
  }))
  readonly promoteMutation = injectMutation(() => ({
    mutationFn: (id: string) => this.api.promoteRelease(id),
  }))
  readonly stopMutation = injectMutation(() => ({
    mutationFn: (channel: ReleaseChannel) => this.api.stopReleaseChannel(channel),
  }))
  readonly resumeMutation = injectMutation(() => ({
    mutationFn: (channel: ReleaseChannel) => this.api.clearReleaseChannel(channel),
  }))
  readonly promoting = signal<ReleaseChannel | null>(null)
  readonly stopping = signal<ReleaseChannel | null>(null)
  readonly resuming = signal<ReleaseChannel | null>(null)
  readonly mutationStatus = signal("")
  readonly mutationError = signal("")

  constructor() {
    void this.statusQuery.refetch()
  }

  channels() {
    return this.statusQuery.data()?.channels ?? []
  }

  queryError() {
    const error = this.statusQuery.error()
    if (error instanceof Error) return error.message
    return error ? String(error) : "Unknown error"
  }

  busy() {
    return this.promoting() !== null || this.stopping() !== null || this.resuming() !== null
  }

  channelLabel(channel: ReleaseChannel) {
    if (channel === "ai-gilde") return "AI-Gilde"
    if (channel === "beta") return "Beta"
    return "Normal"
  }

  nextChannelLabel(channel: ReleaseChannel) {
    return channel === "beta" ? "AI-Gilde" : "normal"
  }

  deliveryText(channel: ReleaseChannelStatus) {
    if (!channel.filesAvailable) return "Missing package files"
    return channel.stopped ? "Delivery stopped" : "Delivery active"
  }

  canPromote(channel: ReleaseChannelStatus) {
    return channel.filesAvailable && channel.release?.channel === channel.channel && channel.release.version === channel.version
  }

  canStop(channel: ReleaseChannelStatus) {
    return channel.filesAvailable && !channel.stopped
  }

  promotionHint(channel: ReleaseChannelStatus) {
    if (channel.release?.channel !== channel.channel) return "This release has already been promoted to the next channel."
    if (!channel.filesAvailable) return "The package files for this release are missing."
    return "The active release does not match the release record."
  }

  refresh() {
    void this.statusQuery.refetch()
  }

  promote(channel: ReleaseChannelStatus) {
    if (!channel.release || !this.canPromote(channel) || this.busy()) return
    this.promoting.set(channel.channel)
    this.mutationError.set("")
    this.mutationStatus.set("Promoting…")
    void this.promoteMutation
      .mutateAsync(channel.release.id)
      .then(async (release) => {
        await this.queryClient.invalidateQueries({ queryKey: ["release-status"] })
        this.mutationStatus.set(`Promoted ${release.version} to ${this.nextChannelLabel(channel.channel)}`)
      })
      .catch((error) => this.setError(error, "Promotion failed"))
      .finally(() => this.promoting.set(null))
  }

  stop(channel: ReleaseChannelStatus) {
    if (!this.canStop(channel) || this.busy()) return
    this.stopping.set(channel.channel)
    this.mutationError.set("")
    this.mutationStatus.set(`Stopping ${this.channelLabel(channel.channel)}…`)
    void this.stopMutation
      .mutateAsync(channel.channel)
      .then(async () => {
        await this.queryClient.invalidateQueries({ queryKey: ["release-status"] })
        this.mutationStatus.set(`Stopped ${this.channelLabel(channel.channel)}`)
      })
      .catch((error) => this.setError(error, "Stop failed"))
      .finally(() => this.stopping.set(null))
  }

  resume(channel: ReleaseChannelStatus) {
    if (!channel.stopped || !channel.filesAvailable || this.busy()) return
    this.resuming.set(channel.channel)
    this.mutationError.set("")
    this.mutationStatus.set(`Resuming ${this.channelLabel(channel.channel)}…`)
    void this.resumeMutation
      .mutateAsync(channel.channel)
      .then(async () => {
        await this.queryClient.invalidateQueries({ queryKey: ["release-status"] })
        this.mutationStatus.set(`Resumed ${this.channelLabel(channel.channel)}`)
      })
      .catch((error) => this.setError(error, "Resume failed"))
      .finally(() => this.resuming.set(null))
  }

  private setError(error: unknown, fallback: string) {
    this.mutationStatus.set(fallback)
    this.mutationError.set(error instanceof Error ? error.message : String(error))
  }
}
