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
      <p>Upload ZIP into beta. Version comes from <code>latest.yml</code>.</p>
      <div class="status-row">
        <section class="status-box">
          <span>Beta Channel</span>
          <strong>{{ betaVersionText }}</strong>
          <small>{{ betaNotesText }}</small>
        </section>
        <section class="status-box">
          <span>Normal Channel</span>
          <strong>{{ normalVersionText }}</strong>
          <small>{{ normalStateText }}</small>
        </section>
        <section class="status-box">
          <span>Beta testers</span>
          <strong>{{ betaUserCount }}</strong>
          <small>{{ betaPositiveThreshold }} positive approvals needed</small>
        </section>
      </div>
      <form (submit)="submit($event)">
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

  get betaVersionText() {
    return this.statusQuery.data()?.betaRelease?.version || "No beta release yet"
  }

  get betaNotesText() {
    return this.statusQuery.data()?.betaRelease?.notes || "Waiting for first beta ZIP"
  }

  get normalVersionText() {
    return this.statusQuery.data()?.normalRelease?.version || "No normal release yet"
  }

  get normalStateText() {
    return this.statusQuery.data()?.normalStopped ? "Delivery stopped" : "Delivery active"
  }

  get betaUserCount() {
    return this.statusQuery.data()?.betaUserCount ?? 0
  }

  get betaPositiveThreshold() {
    return this.statusQuery.data()?.betaPositiveThreshold ?? 0
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
          this.statusText = `Uploaded ${release.version}`
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
