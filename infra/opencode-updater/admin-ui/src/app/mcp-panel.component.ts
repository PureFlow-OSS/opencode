import { Component, inject } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { injectMutation, injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService, McpConfig } from "./api.service"

type Channel = "normal" | "beta"

type McpDraft = {
  name: string
  type: McpConfig["type"]
  enabled: boolean
  url: string
  command: string
  timeout: string
  headers: string
  environment: string
  usePat: boolean
  patLabel: string
  patDescription: string
  patPlaceholder: string
  patHeader: string
  patPrefix: string
}

const emptyDraft = (): McpDraft => ({
  name: "",
  type: "remote",
  enabled: true,
  url: "",
  command: "",
  timeout: "",
  headers: "",
  environment: "",
  usePat: false,
  patLabel: "",
  patDescription: "",
  patPlaceholder: "",
  patHeader: "Authorization",
  patPrefix: "Bearer ",
})

@Component({
  selector: "app-mcp-panel",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./mcp-panel.component.html",
  styleUrl: "./mcp-panel.component.css",
})
export class McpPanelComponent {
  readonly api = inject(ApiService)
  readonly mcps = injectQuery(() => ({
    queryKey: ["mcps", this.channel],
    queryFn: () => this.api.listMcps(this.channel),
  }))
  readonly saveMutation = injectMutation(() => ({
    mutationFn: (input: { name: string; config: McpConfig }) => this.api.saveMcp(this.channel, input.name, input.config),
  }))
  readonly deleteMutation = injectMutation(() => ({
    mutationFn: (name: string) => this.api.deleteMcp(this.channel, name),
  }))

  channel: Channel = "beta"
  draft = emptyDraft()
  editing?: string
  status = ""
  error = ""

  entries() {
    return Object.entries(this.mcps.data() ?? {})
  }

  selectChannel(channel: Channel) {
    if (this.channel === channel) return
    this.channel = channel
    this.cancel()
    void this.mcps.refetch()
  }

  add() {
    this.editing = "new"
    this.draft = emptyDraft()
    this.status = ""
    this.error = ""
  }

  edit(name: string, config: McpConfig) {
    this.editing = name
    this.draft = {
      name,
      type: config.type,
      enabled: config.enabled !== false,
      url: config.url ?? "",
      command: (config.command ?? []).join(" "),
      timeout: config.timeout ? String(config.timeout) : "",
      headers: this.stringifyEntries(config.headers),
      environment: this.stringifyEntries(config.environment),
      usePat: config.auth?.type === "pat",
      patLabel: config.auth?.label ?? "",
      patDescription: config.auth?.description ?? "",
      patPlaceholder: config.auth?.placeholder ?? "",
      patHeader: config.auth?.header ?? "Authorization",
      patPrefix: config.auth?.prefix ?? "Bearer ",
    }
    this.status = ""
    this.error = ""
  }

  cancel() {
    this.editing = undefined
    this.draft = emptyDraft()
    this.status = ""
    this.error = ""
  }

  submit(event: SubmitEvent) {
    event.preventDefault()
    const name = this.draft.name.trim()
    if (!name) {
      this.error = "Enter a unique MCP name."
      return
    }
    this.error = ""
    const headers = this.parseEntries(this.draft.headers, "headers")
    if (this.error) return
    const environment = this.parseEntries(this.draft.environment, "environment variables")
    if (this.error) return
    const timeout = this.draft.timeout.trim() ? Number(this.draft.timeout) : undefined
    if (timeout !== undefined && (!Number.isInteger(timeout) || timeout <= 0)) {
      this.error = "Timeout must be a positive whole number."
      return
    }
    const command = this.draft.command.trim().split(/\s+/).filter(Boolean)
    const config: McpConfig = {
      type: this.draft.type,
      enabled: this.draft.enabled,
      ...(timeout ? { timeout } : {}),
      ...(headers ? { headers } : {}),
      ...(environment ? { environment } : {}),
      ...(this.draft.type === "remote" ? { url: this.draft.url.trim() } : { command }),
      ...(this.draft.usePat
        ? {
            auth: {
              type: "pat",
              ...(this.draft.patLabel.trim() ? { label: this.draft.patLabel.trim() } : {}),
              ...(this.draft.patDescription.trim() ? { description: this.draft.patDescription.trim() } : {}),
              ...(this.draft.patPlaceholder.trim() ? { placeholder: this.draft.patPlaceholder.trim() } : {}),
              ...(this.draft.patHeader.trim() ? { header: this.draft.patHeader.trim() } : {}),
              ...(this.draft.patPrefix ? { prefix: this.draft.patPrefix } : {}),
            },
          }
        : {}),
    }
    this.status = "Saving…"
    this.saveMutation.mutate(
      { name, config },
      {
        onSuccess: async () => {
          this.status = `${name} is managed for the ${this.channel} channel.`
          this.editing = undefined
          await this.mcps.refetch()
        },
        onError: (error) => {
          this.status = ""
          this.error = error instanceof Error ? error.message : String(error)
        },
      },
    )
  }

  remove(name: string) {
    if (!confirm(`Remove managed MCP “${name}” from the ${this.channel} channel?`)) return
    this.status = ""
    this.error = ""
    this.deleteMutation.mutate(name, {
      onSuccess: async () => {
        this.status = `${name} was removed.`
        if (this.editing === name) this.cancel()
        await this.mcps.refetch()
      },
      onError: (error) => (this.error = error instanceof Error ? error.message : String(error)),
    })
  }

  private stringifyEntries(entries?: Record<string, string>) {
    return Object.entries(entries ?? {}).map(([key, value]) => `${key}=${value}`).join("\n")
  }

  private parseEntries(value: string, label: string) {
    const result: Record<string, string> = {}
    for (const line of value.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const separator = trimmed.indexOf("=")
      if (separator < 1) {
        this.error = `Each ${label} entry must use KEY=value.`
        return
      }
      result[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim()
    }
    return Object.keys(result).length ? result : undefined
  }
}
