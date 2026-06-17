import { Component, Input, inject } from "@angular/core"
import { injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService } from "./api.service"

type FeedbackRecord = {
  id: string
  text: string
  category: string
  userName: string
  appVersion?: string | null
  platform?: string | null
  createdAt: string
}

const betaSentimentPattern = /^(Version erfolgreich getestet|Fehler gefunden)\s*\n?/i

function betaSentiment(text: string) {
  const match = text.match(betaSentimentPattern)?.[1]?.toLowerCase()
  if (match === "version erfolgreich getestet") return "positive"
  if (match === "fehler gefunden") return "negative"
  return "neutral"
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
                Beta testers have not submitted any beta feedback yet.
              } @else {
                OpenCode has not sent any general feedback yet.
              }
            </p>
          </section>
        }
        @for (item of visibleFeedback; track item.id) {
          <section class="item">
            <div class="item-top">
              <strong>{{ displayName(item) }}</strong>
              <span>
                @if (mode === 'beta') {
                  {{ betaSentiment(item.text) }}
                } @else {
                  {{ item.category }}
                }
              </span>
            </div>
            <p>{{ item.text }}</p>
            <small>
              {{ item.platform || 'unknown platform' }}
              @if (item.appVersion) {
                · v{{ item.appVersion }}
              }
              · {{ item.createdAt }}
            </small>
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
    return this.mode === "beta" ? current.filter((item) => item.category === "beta") : current.filter((item) => item.category === "general")
  }

  displayName(item: FeedbackRecord) {
    return item.userName || `OpenCode ${item.appVersion ?? "feedback"}`
  }

  refresh() {
    void this.feedbackQuery.refetch()
  }
}
