import { Component, inject, signal } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { injectMutation, injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService, PluginStoreItem } from "./api.service"

const emptyDraft = (): PluginStoreItem => ({ name: "", package: "", description: "", enabled: true })

@Component({
  selector: "app-plugin-store-panel",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./plugin-store-panel.component.html",
  styleUrl: "./mcp-store-panel.component.css",
})
export class PluginStorePanelComponent {
  readonly api = inject(ApiService)
  readonly store = injectQuery(() => ({ queryKey: ["plugin-store"], queryFn: () => this.api.listPluginStore() }))
  readonly saveMutation = injectMutation(() => ({
    mutationFn: (item: PluginStoreItem) => this.api.savePluginStoreItem(item.name, item),
  }))
  readonly deleteMutation = injectMutation(() => ({
    mutationFn: (name: string) => this.api.deletePluginStoreItem(name),
  }))
  readonly editing = signal<string | undefined>(undefined)
  readonly error = signal("")
  readonly status = signal("")
  draft = emptyDraft()

  edit(item?: PluginStoreItem) {
    this.editing.set(item?.name ?? "")
    this.draft = item ? { ...item } : emptyDraft()
    this.error.set("")
    this.status.set("")
  }

  cancel() {
    this.editing.set(undefined)
    this.draft = emptyDraft()
  }

  submit(event: SubmitEvent) {
    event.preventDefault()
    this.error.set("")
    this.status.set("")
    this.saveMutation.mutate(
      {
        ...this.draft,
        name: this.draft.name.trim(),
        package: this.draft.package.trim(),
        description: this.draft.description?.trim(),
      },
      {
        onSuccess: async () => {
          this.cancel()
          this.status.set("Plugin store entry saved.")
          await this.store.refetch()
        },
        onError: (error) => this.error.set(error.message),
      },
    )
  }

  remove(name: string) {
    if (!confirm(`Remove “${name}” from the plugin store? Existing installations are kept.`)) return
    this.error.set("")
    this.status.set("")
    this.deleteMutation.mutate(name, {
      onSuccess: async () => {
        if (this.editing() === name) this.cancel()
        this.status.set("Plugin store entry removed.")
        await this.store.refetch()
      },
      onError: (error) => this.error.set(error.message),
    })
  }
}
