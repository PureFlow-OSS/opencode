import { Component, inject, signal } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { injectMutation, injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService, McpStoreItem } from "./api.service"

type StoreDraft = {
  use_http_proxy: boolean
  oauthRequired: boolean
  name: string
  description: string
  url: string
  headerNames: string[]
  headerPlaceholder: string
  enabled: boolean
}

const emptyDraft = (): StoreDraft => ({
  use_http_proxy: false,
  oauthRequired: false,
  name: "",
  description: "",
  url: "",
  headerNames: [""],
  headerPlaceholder: "",
  enabled: true,
})

@Component({
  selector: "app-mcp-store-panel",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./mcp-store-panel.component.html",
  styleUrl: "./mcp-store-panel.component.css",
})
export class McpStorePanelComponent {
  readonly api = inject(ApiService)
  readonly store = injectQuery(() => ({
    queryKey: ["mcp-store"],
    queryFn: () => this.api.listMcpStore(),
  }))
  readonly saveMutation = injectMutation(() => ({
    mutationFn: (input: { name: string; item: Omit<McpStoreItem, "updatedAt"> }) => this.api.saveMcpStoreItem(input.name, input.item),
  }))
  readonly deleteMutation = injectMutation(() => ({
    mutationFn: (name: string) => this.api.deleteMcpStoreItem(name),
  }))

  draft = emptyDraft()
  readonly editing = signal<string | undefined>(undefined)
  readonly error = signal("")
  readonly status = signal("")

  items() {
    return this.store.data() ?? []
  }

  add() {
    this.editing.set("new")
    this.draft = emptyDraft()
    this.error.set("")
    this.status.set("")
  }

  edit(item: McpStoreItem) {
    this.editing.set(item.name)
    this.draft = {
      use_http_proxy: item.use_http_proxy ?? false,
      oauthRequired: item.oauthRequired ?? false,
      name: item.name,
      description: item.description ?? "",
      url: item.url,
      headerNames: item.headerNames.length ? [...item.headerNames] : [""],
      headerPlaceholder: item.headerPlaceholder ?? "",
      enabled: item.enabled,
    }
    this.error.set("")
    this.status.set("")
  }

  addHeader() {
    this.draft.headerNames.push("")
  }

  removeHeader(index: number) {
    this.draft.headerNames.splice(index, 1)
    if (this.draft.headerNames.length === 0) this.draft.headerNames.push("")
  }

  setHeader(index: number, value: string) {
    this.draft.headerNames[index] = value
  }

  cancel() {
    this.editing.set(undefined)
    this.draft = emptyDraft()
    this.error.set("")
    this.status.set("")
  }

  submit(event: SubmitEvent) {
    event.preventDefault()
    const name = this.draft.name.trim()
    if (!name) {
      this.error.set("Enter a unique store name.")
      return
    }
    if (!this.draft.url.trim()) {
      this.error.set("Enter the MCP URL.")
      return
    }
    const headerNames = this.draft.headerNames.map((header) => header.trim()).filter(Boolean)
    if (!this.draft.oauthRequired && headerNames.length === 0) {
      this.error.set("Add at least one header name (users fill in the values in OpenCode).")
      return
    }
    if (new Set(headerNames.map((header) => header.toLowerCase())).size !== headerNames.length) {
      this.error.set("Header names must be unique.")
      return
    }
    this.error.set("")
    this.status.set("Saving…")
    this.saveMutation.mutate(
      {
        name,
        item: {
          use_http_proxy: this.draft.use_http_proxy,
          oauthRequired: this.draft.oauthRequired,
          name,
          description: this.draft.description.trim() || null,
          url: this.draft.url.trim(),
          headerNames,
          headerPlaceholder: this.draft.headerPlaceholder.trim() || null,
          enabled: this.draft.enabled,
        },
      },
      {
        onSuccess: async () => {
          this.status.set(`${name} is available in the MCP store.`)
          this.editing.set(undefined)
          await this.store.refetch()
        },
        onError: (error) => {
          this.status.set("")
          this.error.set(error instanceof Error ? error.message : String(error))
        },
      },
    )
  }

  remove(name: string) {
    if (!confirm(`Remove “${name}” from the MCP store?`)) return
    this.status.set("")
    this.error.set("")
    this.deleteMutation.mutate(name, {
      onSuccess: async () => {
        this.status.set(`${name} was removed.`)
        if (this.editing() === name) this.cancel()
        await this.store.refetch()
      },
      onError: (error) => this.error.set(error instanceof Error ? error.message : String(error)),
    })
  }
}
