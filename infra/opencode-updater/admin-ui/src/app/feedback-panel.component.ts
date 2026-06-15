import { Component, Input, inject } from "@angular/core"
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
          Beta feedback. Positive items can later move into normal channel.
        } @else {
          General inbox. Demo entries show how reviews look before live feedback arrives.
        }
      </p>
      <button type="button" class="secondary" (click)="refresh()">Refresh inbox</button>
      <div class="list">
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
  feedback: FeedbackRecord[] = []

  readonly demoFeedback: FeedbackRecord[] = [
    {
      id: "demo-1",
      channel: "general",
      userName: "Mara",
      userEmail: "mara@test.local",
      rating: "positive",
      message: "Search feels faster. Please keep the new command palette behavior.",
      createdAt: "demo",
    },
    {
      id: "demo-2",
      channel: "general",
      userName: "Jonas",
      userEmail: "jonas@test.local",
      rating: "neutral",
      message: "Would love a clearer error state when upload is empty.",
      createdAt: "demo",
    },
    {
      id: "demo-3",
      channel: "beta",
      userName: "Tina",
      userEmail: "tina@test.local",
      rating: "positive",
      message: "Beta build starts clean. Please test changelog link and restart flow.",
      createdAt: "demo",
    },
  ]

  constructor() {
    void this.refresh()
  }

  get visibleFeedback() {
    const source = this.feedback.length > 0 ? this.feedback : this.demoFeedback
    return this.mode === "beta" ? source.filter((item) => item.channel === "beta") : source.filter((item) => item.channel === "general")
  }

  async refresh() {
    this.feedback = await this.api.listFeedback()
  }
}
