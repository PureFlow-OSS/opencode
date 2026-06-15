import { Component, inject } from "@angular/core"
import { ApiService } from "./api.service"

@Component({
  selector: "app-upload-panel",
  standalone: true,
  template: `
    <article class="card">
      <h2>Beta Upload</h2>
      <p>Upload a ZIP release and publish it into the beta channel.</p>
      <form (submit)="submit($event)">
        <label>
          Version
          <input name="version" placeholder="1.14.36-beta.1" />
        </label>
        <label>
          ZIP file
          <input name="archive" type="file" accept=".zip,application/zip" />
        </label>
        <label>
          Notes
          <textarea name="notes" rows="4"></textarea>
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
      version: (form.elements.namedItem("version") as HTMLInputElement).value,
      archive: archive.files[0],
      notes: (form.elements.namedItem("notes") as HTMLTextAreaElement).value,
    })
  }
}
