import { Component, Input, inject, signal } from "@angular/core"
import { injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService } from "./api.service"
import { formatDateTime } from "./format-date"

type FeedbackRecord = {
  id: string
  text: string
  category: string
  betaSentiment: string | null
  userName: string
  appVersion?: string | null
  platform?: string | null
  attachments: FeedbackAttachment[]
  createdAt: string
}

type FeedbackAttachment = {
  name: string
  type: string
  dataUrl: string
  image: boolean
}

const betaSentimentPattern = /^(Version erfolgreich getestet|Fehler gefunden)\s*\n?/i

function betaSentiment(item: FeedbackRecord) {
  if (item.betaSentiment === "positive" || item.betaSentiment === "negative") return item.betaSentiment
  const match = item.text.match(betaSentimentPattern)?.[1]?.toLowerCase()
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
      <div class="toolbar">
        <button type="button" class="secondary refresh" [disabled]="feedbackQuery.isFetching()" (click)="refresh()">
          <span class="refresh-icon" [class.spinning]="feedbackQuery.isFetching()" aria-hidden="true">↻</span>
          {{ feedbackQuery.isFetching() ? 'Refreshing inbox…' : 'Refresh inbox' }}
        </button>
        <label>
          Version
          <select [value]="selectedVersion()" (change)="selectVersion($event)">
            <option value="all">Alle</option>
            @for (version of versions; track version) {
              <option [value]="version">{{ version }}</option>
            }
          </select>
        </label>
        <label>
          Kategorie
          <select [value]="selectedCategory()" (change)="selectCategory($event)">
            <option value="all">Alle</option>
            @for (category of categories; track category) {
              <option [value]="category">{{ categoryLabel(category) }}</option>
            }
          </select>
        </label>
      </div>
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
                  {{ betaSentiment(item) }}
                } @else {
                  {{ categoryLabel(item.category) }}
                }
              </span>
            </div>
            <p>{{ item.text }}</p>
            @if (item.attachments.length > 0) {
              <div class="attachments">
                @for (attachment of item.attachments; track attachment.name) {
                  <a class="attachment" [href]="attachment.dataUrl" [download]="attachment.name">
                    @if (attachment.image) {
                      <img [src]="attachment.dataUrl" [alt]="attachment.name" />
                    } @else {
                      <span>{{ attachment.name }}</span>
                    }
                  </a>
                }
              </div>
            }
            <small>
              {{ item.platform || 'unknown platform' }}
              @if (item.appVersion) {
                · v{{ item.appVersion }}
              }
              · {{ formatDateTime(item.createdAt) }}
            </small>
          </section>
        }
      </div>
    </article>
  `,
  styleUrl: "./feedback-panel.component.css",
})
export class FeedbackPanelComponent {
  readonly api = inject(ApiService)
  readonly formatDateTime = formatDateTime
  @Input() mode: "beta" | "inbox" = "inbox"
  readonly selectedVersion = signal("all")
  readonly selectedCategory = signal("all")
  readonly feedbackQuery = injectQuery(() => ({
    queryKey: ["feedback-inbox"],
    queryFn: () => this.api.listFeedback(),
  }))

  constructor() {
    void this.feedbackQuery.refetch()
  }

  get visibleFeedback() {
    return this.feedback.filter(
      (item) =>
        (this.selectedVersion() === "all" || item.appVersion === this.selectedVersion()) &&
        (this.selectedCategory() === "all" || item.category === this.selectedCategory()),
    )
  }

  get feedback() {
    const current = this.feedbackQuery.data() ?? []
    return this.mode === "beta" ? current.filter((item) => item.category === "beta") : current.filter((item) => item.category !== "beta")
  }

  get versions() {
    return [...new Set(this.feedback.map((item) => item.appVersion).filter((version): version is string => !!version))].sort()
  }

  get categories() {
    return [...new Set(this.feedback.map((item) => item.category))].sort()
  }

  displayName(item: FeedbackRecord) {
    return item.userName || `OpenCode ${item.appVersion ?? "feedback"}`
  }

  categoryLabel(category: string) {
    if (category === "bug") return "Fehler melden"
    if (category === "idea") return "Funktionsvorschlag"
    if (category === "beta") return "Beta"
    return "Allgemein"
  }

  refresh() {
    void this.feedbackQuery.refetch()
  }

  selectVersion(event: Event) {
    this.selectedVersion.set((event.target as HTMLSelectElement).value)
  }

  selectCategory(event: Event) {
    this.selectedCategory.set((event.target as HTMLSelectElement).value)
  }
}
