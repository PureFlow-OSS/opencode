import { Component, inject } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { injectMutation, injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService, McpStoreItem } from "./api.service"

type StoreDraft = {
  name: string
  description: string
  url: string
  headerNames: string[]
  headerPlaceholder: string
  enabled: boolean
}

const emptyDraft = (): StoreDraft => ({
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
  editing?: string
  error = ""
  status = ""

  items() {
    return this.store.data() ?? []
  }

  add() {
    this.editing = "new"
    this.draft = emptyDraft()
    this.error = ""
    this.status = ""
  }

  edit(item: McpStoreItem) {
    this.editing = item.name
    this.draft = {
      name: item.name,
      description: item.description ?? "",
      url: item.url,
      headerNames: item.headerNames.length ? [...item.headerNames] : [""],
      headerPlaceholder: item.headerPlaceholder ?? "",
      enabled: item.enabled,
    }
    this.error = ""
    this.status = ""
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
    this.editing = undefined
    this.draft = emptyDraft()
    this.error = ""
    this.status = ""
  }

  submit(event: SubmitEvent) {
    event.preventDefault()
    const name = this.draft.name.trim()
    if (!name) {
      this.error = "Enter a unique store name."
      return
    }
    if (!this.draft.url.trim()) {
      this.error = "Enter the MCP URL."
      return
    }
    const headerNames = this.draft.headerNames.map((header) => header.trim()).filter(Boolean)
    if (headerNames.length === 0) {
      this.error = "Add at least one header name (users fill in the values in OpenCode)."
      return
    }
    if (new Set(headerNames.map((header) => header.toLowerCase())).size !== headerNames.length) {
      this.error = "Header names must be unique."
      return
    }
    this.error = ""
    this.status = "Saving…"
    this.saveMutation.mutate(
      {
        name,
        item: {
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
          this.status = `${name} is available in the MCP store.`
          this.editing = undefined
          await this.store.refetch()
        },
        onError: (error) => {
          this.status = ""
          this.error = error instanceof Error ? error.message : String(error)
        },
      },
    )
  }

  remove(name: string) {
    if (!confirm(`Remove “${name}” from the MCP store?`)) return
    this.status = ""
    this.error = ""
    this.deleteMutation.mutate(name, {
      onSuccess: async () => {
        this.status = `${name} was removed.`
        if (this.editing === name) this.cancel()
        await this.store.refetch()
      },
      onError: (error) => (this.error = error instanceof Error ? error.message : String(error)),
    })
  }
}
