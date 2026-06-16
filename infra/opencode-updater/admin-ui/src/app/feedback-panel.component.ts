import { Component, Input, inject } from "@angular/core"
import { injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService } from "./api.service"

type FeedbackRecord = {
  id: string
  channel: string
  releaseId?: string | null
  userName?: string | null
  userEmail?: string | null
  rating: string
  message: string
  createdAt: string
}

@Component({
  selector: "app-feedback-panel",
  standalone: true,
  template: `
    <article class="card">
      <h2>{{ mode === 'beta' ? 'Beta Feedback Inbox' : 'Feedback Inbox' }}</h2>
      <p>
        @if (mode === 'beta') {
          Live beta feedback from OpenCode. Positive items can later move into normal channel.
        } @else {
          General inbox. Live feedback from OpenCode lands here.
        }
      </p>
      <button type="button" class="secondary" (click)="refresh()">Refresh inbox</button>
      <div class="list">
        @if (visibleFeedback.length === 0) {
          <section class="item empty">
            <strong>No feedback yet</strong>
            <p>
              @if (mode === 'beta') {
                Beta testers have not submitted any feedback yet.
              } @else {
                OpenCode has not sent any general feedback yet.
              }
            </p>
          </section>
        }
        @for (item of visibleFeedback; track item.id) {
          <section class="item">
            <div class="item-top">
              <strong>{{ item.userName || 'anonymous' }}</strong>
              <span>{{ item.channel }} · {{ item.rating }}</span>
            </div>
            <p>{{ item.message }}</p>
            <small>{{ item.userEmail || 'no email' }} · {{ item.createdAt }}</small>
          </section>
        }
      </div>
    </article>
  `,
})
export class FeedbackPanelComponent {
  readonly api = inject(ApiService)
  @Input() mode: "beta" | "inbox" = "inbox"
  readonly feedbackQuery = injectQuery(() => ({
    queryKey: ["feedback-inbox"],
    queryFn: () => this.api.listFeedback(),
  }))

  constructor() {
    void this.feedbackQuery.refetch()
  }

  get visibleFeedback() {
    const current = this.feedbackQuery.data() ?? []
    return this.mode === "beta" ? current.filter((item) => item.channel === "beta") : current.filter((item) => item.channel === "general")
  }

  refresh() {
    void this.feedbackQuery.refetch()
  }
}
