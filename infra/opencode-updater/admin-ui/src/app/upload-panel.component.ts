import { Component, inject } from "@angular/core"
import { ApiService } from "./api.service"

@Component({
  selector: "app-upload-panel",
  standalone: true,
  template: `
    <article class="card">
      <h2>Beta Upload</h2>
      <p>Upload a ZIP release and publish it into the beta channel. The version is read from <code>latest.yml</code>.</p>
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

  submit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const archive = form.elements.namedItem("archive") as HTMLInputElement
    if (!archive.files?.[0]) return
    void this.api.uploadRelease({
      archive: archive.files[0],
      notes: (form.elements.namedItem("notes") as HTMLTextAreaElement).value,
    })
  }
}
