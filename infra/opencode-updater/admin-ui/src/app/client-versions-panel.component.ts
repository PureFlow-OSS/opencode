import { Component, computed, inject, signal } from "@angular/core"
import { injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService } from "./api.service"
import { formatDateTime } from "./format-date"

@Component({
  selector: "app-client-versions-panel",
  standalone: true,
  templateUrl: "./client-versions-panel.component.html",
  styles: [`
    .controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
    .results { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: start; padding: 10px; border-bottom: 1px solid var(--line, #d6dfe7); }
  `],
})
export class ClientVersionsPanelComponent {
  private readonly api = inject(ApiService)
  readonly query = injectQuery(() => ({
    queryKey: ["client-versions"],
    queryFn: () => this.api.clientVersions(),
    refetchInterval: 30_000,
  }))
  readonly search = signal("")
  readonly formatDateTime = formatDateTime
  readonly labels = { normal: "Normal", beta: "Beta", "ai-gilde": "AI-Gilde" }
  readonly rows = computed(() => {
    const data = this.query.data()
    const search = this.search().trim().toLowerCase()
    const channels = new Map(data?.channels.map((channel) => [channel.channel, channel]))
    return (data?.clients ?? [])
      .filter((report) => [report.userName, report.version, this.labels[report.channel]].some(
        (value) => value.toLowerCase().includes(search),
      ))
      .map((report) => ({ ...report, target: channels.get(report.channel) }))
  })

  matches(version: string, target: string) {
    return version.split("+")[0] === target.split("+")[0]
  }
}
