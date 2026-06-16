import { Component, effect, inject } from "@angular/core"
import { injectMutation, injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService } from "./api.service"

type ReleaseRecord = {
  id: string
  version: string
  channel: string
  zipName: string
  zipSize: number
  notes?: string | null
  promoted: boolean
  positiveCount: number
  totalCount: number
  createdAt: string
}

@Component({
  selector: "app-upload-panel",
  standalone: true,
  template: `
    <article class="card">
      <h2>Beta Upload</h2>
      <p>Upload a ZIP into the beta feed. The version is read from <code>latest.yml</code> inside the archive.</p>
      <div class="status-row">
        <section class="status-box">
          <span>Beta Channel</span>
          <strong>{{ betaFeedVersion }}</strong>
          <small>{{ betaReleaseLabel }}</small>
        </section>
        <section class="status-box">
          <span>Normal Channel</span>
          <strong>{{ normalFeedVersion }}</strong>
          <small>{{ normalStateText }}</small>
        </section>
        <section class="status-box">
          <span>Beta testers</span>
          <strong>{{ betaUserCount }}</strong>
          <small>{{ betaPositiveThreshold }} positive approvals required</small>
        </section>
      </div>
      <form class="form" (submit)="submit($event)">
        <label>
          ZIP file
          <input name="archive" type="file" accept=".zip,application/zip" />
        </label>
        <label>
          Notes
          <textarea name="notes" rows="4" placeholder="Tell beta testers what to verify"></textarea>
        </label>
        <button type="submit">Publish beta</button>
      </form>
      <p class="status-text" [class.error]="!!statusError">{{ statusText }}</p>
    </article>
  `,
})
export class UploadPanelComponent {
  readonly api = inject(ApiService)
  readonly statusQuery = injectQuery(() => ({
    queryKey: ["release-status"],
    queryFn: () => this.api.listReleaseStatus(),
  }))
  readonly uploadMutation = injectMutation(() => ({
    mutationFn: (payload: { archive: File; notes?: string }) => this.api.uploadRelease(payload),
  }))
  statusText = ""
  statusError = ""

  constructor() {
    effect(() => {
      if (this.statusQuery.isError()) this.statusText = "Status unavailable"
    })
  }

  private get status() {
    return this.statusQuery.data()
  }

  private get betaRelease() {
    return this.status?.betaRelease ?? [...(this.status?.releases ?? [])].reverse().find((release) => release.channel === "beta")
  }

  private get normalRelease() {
    return this.status?.normalRelease ?? [...(this.status?.releases ?? [])].reverse().find((release) => release.channel === "normal")
  }

  get betaFeedVersion() {
    return this.status?.betaFeedVersion || this.betaRelease?.version || "No beta release yet"
  }

  get betaReleaseLabel() {
    if (!this.betaRelease) return "Waiting for first beta ZIP"
    return this.betaRelease.notes || "No notes provided"
  }

  get normalFeedVersion() {
    return this.status?.normalFeedVersion || this.normalRelease?.version || "No normal release yet"
  }

  get normalStateText() {
    if (!this.status) return "Loading status..."
    return this.status.normalStopped ? "Delivery stopped" : "Delivery active"
  }

  get betaUserCount() {
    return this.status?.betaUserCount ?? 0
  }

  get betaPositiveThreshold() {
    return this.status?.betaPositiveThreshold ?? 0
  }

  submit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const archive = form.elements.namedItem("archive") as HTMLInputElement
    if (!archive.files?.[0]) return
    this.statusText = "Uploading..."
    this.statusError = ""
    this.uploadMutation.mutate(
      {
        archive: archive.files[0],
        notes: (form.elements.namedItem("notes") as HTMLTextAreaElement).value,
      },
      {
        onSuccess: (release) => {
          this.statusText = `Uploaded ${release.version} to beta feed`
          void this.statusQuery.refetch()
        },
        onError: (error) => {
          this.statusError = error instanceof Error ? error.message : String(error)
          this.statusText = "Upload failed"
        },
      },
    )
  }
}
