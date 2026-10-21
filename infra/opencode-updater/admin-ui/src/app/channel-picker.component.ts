import { Component, computed, input, output } from "@angular/core"

export type ChannelValue = "beta" | "normal" | "stable"

/**
 * Shared beta/normal channel switcher with beta offered first.
 * Emits the semantic value "normal"; hosts map it to their API vocabulary
 * ("stable" for model settings, "normal" for MCP).
 */
@Component({
  selector: "app-channel-picker",
  standalone: true,
  template: `
    <div class="channel-switch" role="tablist" aria-label="Updater channel">
      <button type="button" role="tab" [attr.aria-selected]="isBeta()" [class.active]="isBeta()" (click)="select('beta')">Beta channel</button>
      <button type="button" role="tab" [attr.aria-selected]="isNormal()" [class.active]="isNormal()" (click)="select('normal')">Normal channel</button>
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
  readonly channelChange = output<"beta" | "normal">()

  readonly isBeta = computed(() => this.channel() === "beta")
  readonly isNormal = computed(() => this.channel() !== "beta")

  select(value: "beta" | "normal") {
    if (value === "beta" && this.isBeta()) return
    if (value === "normal" && this.isNormal()) return
    this.channelChange.emit(value)
  }
}
