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
          ZIP name
          <input name="zipName" placeholder="opencode-mac.zip" />
        </label>
        <label>
          SHA-256
          <input name="zipSha256" placeholder="..." />
        </label>
        <label>
          Size
          <input name="zipSize" type="number" min="0" />
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
    void this.api.uploadRelease({
      version: (form.elements.namedItem("version") as HTMLInputElement).value,
      zipName: (form.elements.namedItem("zipName") as HTMLInputElement).value,
      zipSha256: (form.elements.namedItem("zipSha256") as HTMLInputElement).value,
      zipSize: Number((form.elements.namedItem("zipSize") as HTMLInputElement).value || 0),
      notes: (form.elements.namedItem("notes") as HTMLTextAreaElement).value,
    })
  }
}
