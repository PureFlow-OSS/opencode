import { Component, inject } from "@angular/core"
import { ApiService } from "./api.service"

@Component({
  selector: "app-feedback-panel",
  standalone: true,
  template: `
    <article class="card">
      <h2>Feedback Inbox</h2>
      <p>General feedback from the OpenCode UI lands here.</p>
      <form (submit)="submit($event)">
        <label>
          Channel
          <select name="channel">
            <option value="general">general</option>
            <option value="beta">beta</option>
          </select>
        </label>
        <label>
          Name
          <input name="userName" />
        </label>
        <label>
          Email
          <input name="userEmail" />
        </label>
        <label>
          Rating
          <select name="rating">
            <option value="positive">positive</option>
            <option value="neutral">neutral</option>
            <option value="negative">negative</option>
          </select>
        </label>
        <label>
          Message
          <textarea name="message" rows="5"></textarea>
        </label>
        <button type="submit">Send feedback</button>
      </form>
    </article>
  `,
})
export class FeedbackPanelComponent {
  readonly api = inject(ApiService)

  submit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    void this.api.createFeedback({
      channel: (form.elements.namedItem("channel") as HTMLSelectElement).value,
      userName: (form.elements.namedItem("userName") as HTMLInputElement).value,
      userEmail: (form.elements.namedItem("userEmail") as HTMLInputElement).value,
      rating: (form.elements.namedItem("rating") as HTMLSelectElement).value,
      message: (form.elements.namedItem("message") as HTMLTextAreaElement).value,
    })
  }
}
