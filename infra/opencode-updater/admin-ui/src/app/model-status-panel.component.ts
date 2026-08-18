import { Component, inject } from "@angular/core"
import { injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService } from "./api.service"

@Component({
  selector: "app-model-status-panel",
  standalone: true,
  template: `
    <article class="card">
      <div class="header-row">
        <div>
          <h2>Model Status</h2>
        </div>
        <div class="count-pill">Models: {{ models().length }}</div>
      </div>
      @if (models().length === 0) {
        <div class="empty-state">No model cards available yet.</div>
      } @else {
        <div class="cards">
          @for (model of models(); track model.model) {
            <section class="model-card">
              <div class="model-card-top">
                <div class="model-name">
                  <strong>{{ model.model }}</strong>
                  <span>{{ model.config?.pattern || 'All models' }}</span>
                </div>
              </div>
              <div class="meta-grid">
                <label class="meta-item document-vision">
                  <small>Document Vision</small>
                  <span>
                    <input
                      type="checkbox"
                      [checked]="model.documentVision"
                      [disabled]="updating === model.model"
                      (change)="setDocumentVision(model.model, $any($event.target).checked)"
                    />
                    Send images and PDFs directly
                  </span>
                </label>
                <div class="meta-item">
                  <small>Context</small>
                  <strong>{{ formatNumber(model.context ?? model.config?.context) }}</strong>
                </div>
                <div class="meta-item">
                  <small>Output</small>
                  <strong>{{ formatNumber(model.output ?? model.config?.output) }}</strong>
                </div>
                <div class="meta-item">
                  <small>Thinking</small>
                  <strong>{{ formatBoolean(model.reasoning ?? model.config?.reasoning) }}</strong>
                </div>
                <div class="meta-item">
                  <small>Input Cost /1M</small>
                  <strong>{{ formatPrice(model.price?.input ?? model.liteLLM?.inputCostPerMillionTokens) }}</strong>
                </div>
                <div class="meta-item">
                  <small>Output Cost /1M</small>
                  <strong>{{ formatPrice(model.price?.output ?? model.liteLLM?.outputCostPerMillionTokens) }}</strong>
                </div>
                @if (model.modalities?.input?.length || model.modalities?.output?.length) {
                  <div class="meta-item">
                    <small>Modalities</small>
                    <strong>
                      {{ (model.modalities?.input || []).join(', ') || 'n/a' }}
                      @if (model.modalities?.output?.length) {
                        → {{ (model.modalities?.output || []).join(', ') }}
                      }
                    </strong>
                  </div>
                }
              </div>
            </section>
          }
        </div>
      }
    </article>
  `,
  styleUrls: ["./model-status-panel.component.css"],
})
export class ModelStatusPanelComponent {
  readonly api = inject(ApiService)
  readonly modelCards = injectQuery(() => ({
    queryKey: ["model-cards"],
    queryFn: () => this.api.listModelCards(),
  }))

  readonly models = () => this.modelCards.data()?.aifactory?.models ?? []
  updating?: string

  async setDocumentVision(model: string, enabled: boolean) {
    this.updating = model
    try {
      await this.api.setDocumentVision(model, enabled)
      await this.modelCards.refetch()
    } finally {
      this.updating = undefined
    }
  }

  formatNumber(value?: number | null) {
    if (value === undefined || value === null) return "n/a"
    return new Intl.NumberFormat("de-DE").format(value)
  }

  formatBoolean(value?: boolean | null) {
    if (value === undefined || value === null) return "n/a"
    return value ? "yes" : "no"
  }

  formatPrice(value?: number | null) {
    if (value === undefined || value === null) return "n/a"
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  }
}
