import { FormsModule } from "@angular/forms"
import { Component, inject, signal } from "@angular/core"
import { injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService, ModelSettings } from "./api.service"

@Component({
  selector: "app-model-status-panel",
  standalone: true,
  imports: [FormsModule],
  template: `
    <article class="card">
      <div class="header-row">
        <div>
          <h2>Model Status</h2>
          <p>Änderungen werden direkt in die gewählte Konfigurationsdatei gespeichert.</p>
        </div>
        <div class="header-actions">
          <select [ngModel]="channel()" (ngModelChange)="setChannel($event)">
            <option value="stable">Stable</option>
            <option value="beta">Beta</option>
          </select>
          <div class="count-pill">Models: {{ models().length }}</div>
        </div>
      </div>
      @if (error()) {
        <div class="error-state">{{ error() }}</div>
      }
      @if (success()) {
        <div class="success-state">{{ success() }}</div>
      }
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
                <button type="button" class="secondary" (click)="edit(model)">Settings</button>
              </div>
              @if (editing() === model.model) {
                <form class="settings-form" (ngSubmit)="save(model.model)">
                  <label>Context <input type="number" min="0" [ngModel]="draft().context" (ngModelChange)="setNumber('context', $event)" name="context" /></label>
                  <label>Output <input type="number" min="0" [ngModel]="draft().output" (ngModelChange)="setNumber('output', $event)" name="output" /></label>
                  <label><input type="checkbox" [ngModel]="draft().temperature" (ngModelChange)="setBoolean('temperature', $event)" name="temperature" /> Temperature</label>
                  <label><input type="checkbox" [ngModel]="draft().reasoning" (ngModelChange)="setBoolean('reasoning', $event)" name="reasoning" /> Thinking</label>
                  <label><input type="checkbox" [ngModel]="draft().document_vision" (ngModelChange)="setBoolean('document_vision', $event)" name="documentVision" /> Document Vision</label>
                  <label><input type="checkbox" [ngModel]="draft().visible" (ngModelChange)="setBoolean('visible', $event)" name="visible" /> Visible in OpenCode</label>
                  <label>Input modalities <input [ngModel]="draft().input_modalities?.join(', ')" (ngModelChange)="setModalities('input_modalities', $event)" name="inputModalities" placeholder="text, image" /></label>
                  <label>Output modalities <input [ngModel]="draft().output_modalities?.join(', ')" (ngModelChange)="setModalities('output_modalities', $event)" name="outputModalities" placeholder="text" /></label>
                  <div class="form-actions">
                    <button type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save' }}</button>
                    <button type="button" class="secondary" (click)="reset(model.model)" [disabled]="saving()">Remove exact {{ channel() }} override</button>
                  </div>
                </form>
              } @else {
                <div class="meta-grid">
                  <div class="meta-item"><small>Context</small><strong>{{ formatNumber(model.config?.context ?? model.context) }}</strong></div>
                  <div class="meta-item"><small>Output</small><strong>{{ formatNumber(model.config?.output ?? model.output) }}</strong></div>
                  <div class="meta-item"><small>Thinking</small><strong>{{ formatBoolean(model.config?.reasoning ?? model.reasoning) }}</strong></div>
                  <div class="meta-item"><small>Document Vision</small><strong>{{ formatBoolean(model.config?.documentVision ?? model.documentVision) }}</strong></div>
                  <div class="meta-item"><small>Visible in OpenCode</small><strong>{{ formatBoolean(model.visible) }}</strong></div>
                  <div class="meta-item"><small>Input Cost /1M</small><strong>{{ formatPrice(model.price?.input ?? model.liteLLM?.inputCostPerMillionTokens) }}</strong></div>
                  <div class="meta-item"><small>Output Cost /1M</small><strong>{{ formatPrice(model.price?.output ?? model.liteLLM?.outputCostPerMillionTokens) }}</strong></div>
                  @if (model.modalities?.input?.length || model.modalities?.output?.length) {
                    <div class="meta-item"><small>Modalities</small><strong>{{ (model.modalities?.input || []).join(', ') || 'n/a' }} @if (model.modalities?.output?.length) { → {{ (model.modalities?.output || []).join(', ') }} }</strong></div>
                  }
                </div>
              }
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
  readonly channel = signal<"stable" | "beta">("stable")
  readonly editing = signal<string | null>(null)
  readonly draft = signal<ModelSettings>({})
  readonly saving = signal(false)
  readonly error = signal<string | null>(null)
  readonly success = signal<string | null>(null)
  readonly modelCards = injectQuery(() => ({
    queryKey: ["model-cards", this.channel()],
    queryFn: () => this.api.listModelCards(this.channel()),
  }))

  readonly models = () => this.modelCards.data()?.aifactory?.models ?? []

  setChannel(channel: "stable" | "beta") {
    this.channel.set(channel)
    this.editing.set(null)
    this.error.set(null)
    this.success.set(null)
  }

  edit(model: { model: string; context?: number | null; output?: number | null; temperature?: boolean | null; reasoning?: boolean | null; documentVision?: boolean; visible?: boolean | null; modalities?: { input?: string[]; output?: string[] } | null; config?: { context?: number | null; output?: number | null; temperature?: boolean | null; reasoning?: boolean | null; documentVision?: boolean | null; modalities?: { input?: string[]; output?: string[] } | null } | null }) {
    this.editing.set(model.model)
    this.draft.set({
      context: model.config?.context ?? model.context ?? null,
      output: model.config?.output ?? model.output ?? null,
      temperature: model.config?.temperature ?? model.temperature ?? null,
      reasoning: model.config?.reasoning ?? model.reasoning ?? null,
      document_vision: model.config?.documentVision ?? model.documentVision ?? false,
      visible: model.visible ?? true,
      input_modalities: model.modalities?.input ?? model.config?.modalities?.input ?? [],
      output_modalities: model.modalities?.output ?? model.config?.modalities?.output ?? [],
    })
  }

  setNumber(key: "context" | "output", value: string) {
    this.draft.update((draft) => ({ ...draft, [key]: value === "" ? null : Number(value) }))
  }

  setBoolean(key: "temperature" | "reasoning" | "document_vision" | "visible", value: boolean) {
    this.draft.update((draft) => ({ ...draft, [key]: value }))
  }

  setModalities(key: "input_modalities" | "output_modalities", value: string) {
    this.draft.update((draft) => ({ ...draft, [key]: value.split(",").map((item) => item.trim()).filter(Boolean) }))
  }

  async save(model: string) {
    this.saving.set(true)
    this.error.set(null)
    this.success.set(null)
    try {
      await this.api.saveModelSettings(model, this.channel(), this.draft())
      this.editing.set(null)
      await this.modelCards.refetch()
      this.success.set(`Saved ${model} to appsettings${this.channel() === "beta" ? ".beta" : ""}.json`)
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : "Could not save model settings")
    } finally {
      this.saving.set(false)
    }
  }

  async reset(model: string) {
    this.saving.set(true)
    this.error.set(null)
    this.success.set(null)
    try {
      await this.api.resetModelSettings(model, this.channel())
      this.editing.set(null)
      await this.modelCards.refetch()
      this.success.set(`Removed the exact ${this.channel()} override for ${model}`)
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : "Could not reset beta settings")
    } finally {
      this.saving.set(false)
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
