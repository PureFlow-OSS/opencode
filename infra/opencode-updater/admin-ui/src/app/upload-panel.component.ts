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
    </article>
  `,
})
export class UploadPanelComponent {
  readonly api = inject(ApiService)
  betaVersion = ""
  betaNotes = ""
  normalVersion = ""
  normalStopped = false

  constructor() {
    void this.refresh()
  }

  async refresh() {
    const status = await this.api.listReleaseStatus()
    this.normalStopped = status.normalStopped
    const beta = status.releases.find((release) => release.channel === "beta")
    const normal = status.releases.find((release) => release.channel === "normal")
    this.betaVersion = beta?.version ?? ""
    this.betaNotes = beta?.notes ?? ""
    this.normalVersion = normal?.version ?? ""
  }

  submit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const archive = form.elements.namedItem("archive") as HTMLInputElement
    if (!archive.files?.[0]) return
    void this.api.uploadRelease({
      archive: archive.files[0],
      notes: (form.elements.namedItem("notes") as HTMLTextAreaElement).value,
    }).then(() => this.refresh())
  }
}
