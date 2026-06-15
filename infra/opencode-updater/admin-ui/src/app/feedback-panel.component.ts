import { Component, inject } from "@angular/core"
import { ApiService } from "./api.service"

@Component({
  selector: "app-feedback-panel",
  standalone: true,
  template: `
    <article class="card">
      <h2>Feedback Inbox</h2>
      <p>General and beta feedback from the OpenCode UI lands here. The admin UI stays read-only.</p>
      <button type="button" class="secondary" (click)="refresh()">Refresh inbox</button>
      <div class="list">
        @for (item of feedback; track item.id) {
          <section class="item">
            <div class="item-top">
              <strong>{{ item.channel }}</strong>
              <span>{{ item.rating }}</span>
            </div>
            <p>{{ item.message }}</p>
            <small>{{ item.userName || 'anonymous' }}{{ item.userEmail ? ' · ' + item.userEmail : '' }}</small>
          </section>
        }
      </div>
    </article>
  `,
})
export class FeedbackPanelComponent {
  readonly api = inject(ApiService)
  feedback: Array<{ id: string; channel: string; userName?: string | null; userEmail?: string | null; rating: string; message: string }> = []

  constructor() {
    void this.refresh()
  }

  async refresh() {
    this.feedback = await this.api.listFeedback()
  }
}
