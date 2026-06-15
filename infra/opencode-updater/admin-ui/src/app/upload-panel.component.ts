import { Component, inject } from "@angular/core"
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
          <strong>{{ betaVersion || 'none' }}</strong>
          <small>{{ betaNotes || 'no beta release yet' }}</small>
        </section>
        <section class="status-box">
          <span>Normal Channel</span>
          <strong>{{ normalVersion || 'none' }}</strong>
          <small>{{ normalStopped ? 'stopped' : 'active' }}</small>
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
  betaVersion = ""
  betaNotes = ""
  normalVersion = ""
  normalStopped = false
  betaUserCount = 0
  betaPositiveThreshold = 0
  statusText = ""
  statusError = ""

  constructor() {
    void this.refresh()
  }

  async refresh() {
    try {
      const status = await this.api.listReleaseStatus()
      this.normalStopped = status.normalStopped
      this.betaUserCount = status.betaUserCount
      this.betaPositiveThreshold = status.betaPositiveThreshold
      const beta = status.releases.find((release) => release.channel === "beta")
      const normal = status.releases.find((release) => release.channel === "normal")
      this.betaVersion = beta?.version ?? ""
      this.betaNotes = beta?.notes ?? ""
      this.normalVersion = normal?.version ?? ""
    } catch {
      this.statusText = "Status unavailable"
    }
  }

  submit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const archive = form.elements.namedItem("archive") as HTMLInputElement
    if (!archive.files?.[0]) return
    this.statusText = "Uploading..."
    this.statusError = ""
    void this.api
      .uploadRelease({
        archive: archive.files[0],
        notes: (form.elements.namedItem("notes") as HTMLTextAreaElement).value,
      })
      .then((release) => {
        this.statusText = `Uploaded ${release.version}`
        void this.refresh()
      })
      .catch((error: Error) => {
        this.statusError = error.message
        this.statusText = "Upload failed"
      })
  }
}
