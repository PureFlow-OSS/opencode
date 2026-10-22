import { Component, computed, input, output } from "@angular/core"

export type ChannelValue = "beta" | "ai-gilde" | "normal" | "stable"

/**
 * Shared channel switcher with beta offered first. Hosts that support the
 * AI-Gilde stage can enable its middle option; the default remains beta/normal.
 */
@Component({
  selector: "app-channel-picker",
  standalone: true,
  template: `
    <div class="channel-switch" role="tablist" aria-label="Updater channel">
      <button type="button" role="tab" [attr.aria-selected]="isBeta()" [class.active]="isBeta()" [disabled]="disabled()" (click)="select('beta')">Beta channel</button>
      @if (allowAiGilde()) {
        <button type="button" role="tab" [attr.aria-selected]="isAiGilde()" [class.active]="isAiGilde()" [disabled]="disabled()" (click)="select('ai-gilde')">AI Gilde</button>
      }
      <button type="button" role="tab" [attr.aria-selected]="isNormal()" [class.active]="isNormal()" [disabled]="disabled()" (click)="select('normal')">Normal channel</button>
    </div>
  `,
  styles: `
    .channel-switch {
      display: inline-flex;
      gap: 0;
      border-radius: 999px;
      border: 1px solid var(--rrz-blue);
      overflow: hidden;
    }

    .channel-switch button {
      padding: 8px 14px;
      background: var(--color-surface);
      border: 0;
      border-radius: 0;
      color: var(--rrz-blue);
      font-size: 11px;
    }

    .channel-switch button + button {
      border-left: 1px solid var(--rrz-blue);
    }

    .channel-switch button:hover {
      background: var(--rrz-blue-soft);
    }

    .channel-switch button.active {
      background: var(--rrz-blue);
      color: #ffffff;
    }
  `,
})
export class ChannelPickerComponent {
  readonly channel = input.required<ChannelValue>()
  readonly allowAiGilde = input(false)
  readonly disabled = input(false)
  readonly channelChange = output<"beta" | "ai-gilde" | "normal">()

  readonly isBeta = computed(() => this.channel() === "beta")
  readonly isAiGilde = computed(() => this.channel() === "ai-gilde")
  readonly isNormal = computed(() => this.channel() === "normal" || this.channel() === "stable")

  select(value: "beta" | "ai-gilde" | "normal") {
    if (this.disabled()) return
    if (value === "ai-gilde" && !this.allowAiGilde()) return
    if (value === "beta" && this.isBeta()) return
    if (value === "normal" && this.isNormal()) return
    this.channelChange.emit(value)
  }
}
