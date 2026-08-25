import { FormsModule } from "@angular/forms"
import { Component, effect, inject, signal } from "@angular/core"
import { injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService, ModelSettings, ProviderSettings } from "./api.service"

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
      <form class="global-settings" (ngSubmit)="saveProviderSettings()">
        <div>
          <h3>Globale Modellvorgaben</h3>
          <p>Diese Modelle gelten für alle OpenCode-Clients des gewählten Kanals, sofern keine lokale Konfiguration sie überschreibt.</p>
        </div>
        <label>Model <input [ngModel]="providerDraft().model" (ngModelChange)="setProviderModel('model', $event)" name="providerModel" required /></label>
        <label>Small model <input [ngModel]="providerDraft().small_model" (ngModelChange)="setProviderModel('small_model', $event)" name="providerSmallModel" required /></label>
        <button type="submit" [disabled]="savingProvider()">{{ savingProvider() ? 'Saving…' : 'Save global models' }}</button>
      </form>
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
                  @if (draft().reasoning) {
                    <fieldset class="reasoning-settings">
                      <legend>Reasoning levels for users</legend>
                      @for (level of reasoningLevels; track level) {
                        <label><input type="checkbox" [checked]="hasReasoningLevel(level)" (change)="setReasoningLevel(level, $any($event.target).checked)" /> {{ level }}</label>
                      }
                      <label>Default
                        <select [ngModel]="draft().default_reasoning_variant" (ngModelChange)="setDefaultReasoningLevel($event)" name="defaultReasoning" [disabled]="!draft().reasoning_variants?.length">
                          <option [ngValue]="null">Select a default</option>
                          @for (level of draft().reasoning_variants || []; track level) {
                            <option [value]="level">{{ level }}</option>
                          }
                        </select>
                      </label>
                    </fieldset>
                  }
                  <label><input type="checkbox" [ngModel]="draft().document_vision" (ngModelChange)="setBoolean('document_vision', $event)" name="documentVision" /> Document Vision</label>
                  <label><input type="checkbox" [ngModel]="draft().document_vision_native" (ngModelChange)="setBoolean('document_vision_native', $event)" name="documentVisionNative" /> Document Vision Native</label>
                  <label>Document OCR model <input [ngModel]="draft().document_ocr_model" (ngModelChange)="setText('document_ocr_model', $event)" name="documentOcrModel" placeholder="GLM-OCR" /></label>
                  <label>Document Vision model <input [ngModel]="draft().document_vision_model" (ngModelChange)="setText('document_vision_model', $event)" name="documentVisionModel" placeholder="Qwen3-VL-4B-Instruct" /></label>
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
                  @if ((model.config?.reasoning ?? model.reasoning) && (model.config?.reasoningVariants ?? model.reasoningVariants)?.length) {
                    <div class="meta-item"><small>Reasoning levels</small><strong>{{ (model.config?.reasoningVariants ?? model.reasoningVariants ?? []).join(', ') }}</strong></div>
                    <div class="meta-item"><small>Default reasoning</small><strong>{{ model.config?.defaultReasoningVariant ?? model.defaultReasoningVariant ?? 'n/a' }}</strong></div>
                  }
                  <div class="meta-item"><small>Document Vision</small><strong>{{ formatBoolean(model.config?.documentVision ?? model.documentVision) }}</strong></div>
                  <div class="meta-item"><small>Document Vision Native</small><strong>{{ formatBoolean(model.config?.documentVisionNative ?? model.documentVisionNative) }}</strong></div>
                  <div class="meta-item"><small>Document OCR model</small><strong>{{ model.config?.documentOcrModel ?? model.documentOcrModel ?? 'n/a' }}</strong></div>
                  <div class="meta-item"><small>Document Vision model</small><strong>{{ model.config?.documentVisionModel ?? model.documentVisionModel ?? 'n/a' }}</strong></div>
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
  readonly providerDraft = signal<ProviderSettings>({})
  readonly saving = signal(false)
  readonly savingProvider = signal(false)
  readonly error = signal<string | null>(null)
  readonly success = signal<string | null>(null)
  readonly reasoningLevels = ["low", "medium", "high", "xhigh"] as const
  readonly modelCards = injectQuery(() => ({
    queryKey: ["model-cards", this.channel()],
    queryFn: () => this.api.listModelCards(this.channel()),
  }))
  readonly providerSettings = injectQuery(() => ({
    queryKey: ["provider-settings", this.channel()],
    queryFn: () => this.api.getProviderSettings(this.channel()),
  }))

  readonly models = () => this.modelCards.data()?.aifactory?.models ?? []

  constructor() {
    effect(() => {
      const settings = this.providerSettings.data()
      if (settings) this.providerDraft.set(settings)
    })
  }

  setChannel(channel: "stable" | "beta") {
    this.channel.set(channel)
    this.editing.set(null)
    this.error.set(null)
    this.success.set(null)
  }

  setProviderModel(key: "model" | "small_model", value: string) {
    this.providerDraft.update((settings) => ({ ...settings, [key]: value }))
  }

  async saveProviderSettings() {
    this.savingProvider.set(true)
    this.error.set(null)
    this.success.set(null)
    try {
      await this.api.saveProviderSettings(this.channel(), this.providerDraft())
      await this.providerSettings.refetch()
      this.success.set(`Saved global models to appsettings${this.channel() === "beta" ? ".beta" : ""}.json`)
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : "Could not save global model settings")
    } finally {
      this.savingProvider.set(false)
    }
  }

  edit(model: { model: string; context?: number | null; output?: number | null; temperature?: boolean | null; reasoning?: boolean | null; reasoningVariants?: string[] | null; defaultReasoningVariant?: string | null; documentVision?: boolean; documentVisionNative?: boolean; documentOcrModel?: string | null; documentVisionModel?: string | null; visible?: boolean | null; modalities?: { input?: string[]; output?: string[] } | null; config?: { context?: number | null; output?: number | null; temperature?: boolean | null; reasoning?: boolean | null; reasoningVariants?: string[] | null; defaultReasoningVariant?: string | null; documentVision?: boolean | null; documentVisionNative?: boolean | null; documentOcrModel?: string | null; documentVisionModel?: string | null; modalities?: { input?: string[]; output?: string[] } | null } | null }) {
    this.editing.set(model.model)
    this.draft.set({
      context: model.config?.context ?? model.context ?? null,
      output: model.config?.output ?? model.output ?? null,
      temperature: model.config?.temperature ?? model.temperature ?? null,
      reasoning: model.config?.reasoning ?? model.reasoning ?? null,
      reasoning_variants: model.config?.reasoningVariants ?? model.reasoningVariants ?? [],
      default_reasoning_variant: model.config?.defaultReasoningVariant ?? model.defaultReasoningVariant ?? null,
      document_vision: model.config?.documentVision ?? model.documentVision ?? false,
      document_vision_native: model.config?.documentVisionNative ?? model.documentVisionNative ?? false,
      document_ocr_model: model.config?.documentOcrModel ?? model.documentOcrModel ?? null,
      document_vision_model: model.config?.documentVisionModel ?? model.documentVisionModel ?? null,
      visible: model.visible ?? true,
      input_modalities: model.modalities?.input ?? model.config?.modalities?.input ?? [],
      output_modalities: model.modalities?.output ?? model.config?.modalities?.output ?? [],
    })
  }

  setNumber(key: "context" | "output", value: string) {
    this.draft.update((draft) => ({ ...draft, [key]: value === "" ? null : Number(value) }))
  }

  setText(key: "document_ocr_model" | "document_vision_model", value: string) {
    this.draft.update((draft) => ({ ...draft, [key]: value.trim() || null }))
  }

  setBoolean(key: "temperature" | "reasoning" | "document_vision" | "document_vision_native" | "visible", value: boolean) {
    this.draft.update((draft) => key === "reasoning" && !value ? { ...draft, reasoning: value, reasoning_variants: [], default_reasoning_variant: null } : { ...draft, [key]: value })
  }

  hasReasoningLevel(level: string) {
    return this.draft().reasoning_variants?.includes(level) ?? false
  }

  setReasoningLevel(level: string, enabled: boolean) {
    this.draft.update((draft) => {
      const reasoning_variants = enabled ? [...new Set([...(draft.reasoning_variants ?? []), level])] : (draft.reasoning_variants ?? []).filter((item) => item !== level)
      return { ...draft, reasoning_variants, default_reasoning_variant: reasoning_variants.includes(draft.default_reasoning_variant ?? "") ? draft.default_reasoning_variant : reasoning_variants[0] ?? null }
    })
  }

  setDefaultReasoningLevel(value: string | null) {
    this.draft.update((draft) => ({ ...draft, default_reasoning_variant: value || null }))
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
