import { Component, effect, inject, signal } from "@angular/core"
import { injectMutation, injectQuery, injectQueryClient } from "@tanstack/angular-query-experimental"
import { ApiService, ReleaseChannel, ReleaseChannelStatus } from "./api.service"

@Component({
  selector: "app-upload-panel",
  standalone: true,
  template: `
    <article class="card">
      <h2>Beta Upload</h2>
      <p>Upload a ZIP into the beta feed. The version is read from <code>latest.yml</code> inside the archive.</p>
      <div class="status-row">
        @for (channel of channels(); track channel.channel) {
          <section class="status-box">
            <span>{{ channelLabel(channel.channel) }}</span>
            <strong>{{ channel.version ?? channel.release?.version ?? "No release yet" }}</strong>
            <small>{{ deliveryText(channel) }}</small>
          </section>
        }
      </div>
      <form class="form" (submit)="submit($event)">
        <label>
          ZIP file
          <input name="archive" type="file" accept=".zip,application/zip" [disabled]="uploading()" />
        </label>
        <label>
          Notes
          <textarea name="notes" rows="4" placeholder="Describe what this beta build changes" [disabled]="uploading()"></textarea>
        </label>
        <button type="submit" [disabled]="uploading()">
          @if (uploading()) {
            Publishing…
          } @else {
            Publish beta
          }
        </button>
      </form>
      @if (statusText()) {
        <p class="status-text" role="status">{{ statusText() }}</p>
      }
      @if (queryError()) {
        <p class="status-text error" role="alert">Release status unavailable: {{ queryError() }}</p>
      }
      @if (statusError()) {
        <p class="status-text error" role="alert">{{ statusError() }}</p>
      }
    </article>
  `,
  styleUrl: "./upload-panel.component.css",
})
export class UploadPanelComponent {
  readonly api = inject(ApiService)
  readonly queryClient = injectQueryClient()
  readonly statusQuery = injectQuery(() => ({
    queryKey: ["release-status"],
    queryFn: () => this.api.listReleaseStatus(),
  }))
  readonly uploadMutation = injectMutation(() => ({
    mutationFn: (payload: { archive: File; notes?: string }) => this.api.uploadRelease(payload),
  }))
  readonly statusText = signal("")
  readonly statusError = signal("")
  readonly queryError = signal("")

  constructor() {
    effect(() => {
      if (this.statusQuery.isError()) {
        const error = this.statusQuery.error()
        this.queryError.set(error instanceof Error ? error.message : error ? String(error) : "Unknown error")
        return
      }
      if (this.statusQuery.isSuccess()) this.queryError.set("")
    })
  }

  channels() {
    return this.statusQuery.data()?.channels ?? []
  }

  uploading() {
    return this.uploadMutation.isPending()
  }

  channelLabel(channel: ReleaseChannel) {
    if (channel === "ai-gilde") return "AI-Gilde"
    if (channel === "beta") return "Beta"
    return "Normal"
  }

  deliveryText(channel: ReleaseChannelStatus) {
    if (!channel.filesAvailable) return "Missing package files"
    return channel.stopped ? "Delivery stopped" : "Delivery active"
  }

  submit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const archive = form.elements.namedItem("archive") as HTMLInputElement
    const file = archive.files?.[0]
    if (!file || this.uploading()) return
    const notes = (form.elements.namedItem("notes") as HTMLTextAreaElement).value
    this.statusText.set("Uploading…")
    this.statusError.set("")
    void this.uploadMutation
      .mutateAsync({ archive: file, notes })
      .then(async (release) => {
        await this.queryClient.invalidateQueries({ queryKey: ["release-status"] })
        this.statusText.set(`Uploaded ${release.version} to beta feed`)
        form.reset()
      })
      .catch((error) => {
        this.statusError.set(error instanceof Error ? error.message : String(error))
        this.statusText.set("Upload failed")
      })
  }
}
