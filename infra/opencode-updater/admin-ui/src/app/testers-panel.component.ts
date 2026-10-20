import { Component, effect, inject } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { injectMutation, injectQuery } from "@tanstack/angular-query-experimental"
import { ApiService } from "./api.service"

@Component({
  selector: "app-testers-panel",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./testers-panel.component.html",
  styleUrl: "./testers-panel.component.css",
})
export class TestersPanelComponent {
  readonly api = inject(ApiService)
  readonly testersQuery = injectQuery(() => ({
    queryKey: ["testers"],
    queryFn: () => this.api.listTesters(),
  }))
  readonly saveMutation = injectMutation(() => ({
    mutationFn: (payload: { betaUsers: string[]; aiGildeUsers: string[] }) => this.api.saveTesters(payload),
  }))
  readonly searchMutation = injectMutation(() => ({
    mutationFn: (term: string) => this.api.searchTesters(term),
  }))

  searchTerm = ""
  status = ""
  error = ""

  constructor() {
    void this.testersQuery.refetch()
    effect(() => {
      if (this.saveMutation.isPending()) return
      this.testersQuery.refetch()
    })
  }

  search(event: Event) {
    event.preventDefault()
    this.error = ""
    this.status = ""
    this.searchMutation.mutate(this.searchTerm.trim(), {
      onError: (error) => (this.error = error instanceof Error ? error.message : String(error)),
    })
  }

  searchResults() {
    return this.searchMutation.data()?.results ?? []
  }

  addTester(channel: "beta" | "ai-gilde", user: string) {
    this.saveMutation.mutate(
      {
        betaUsers: channel === "beta" ? [...this.betaUsers, user] : this.betaUsers.filter((item) => item !== user),
        aiGildeUsers: channel === "ai-gilde" ? [...this.aiGildeUsers, user] : this.aiGildeUsers.filter((item) => item !== user),
      },
      {
        onSuccess: () => {
          this.status = user + " added to " + (channel === "beta" ? "beta" : "AI-Gilde") + " testers."
          this.searchResults()
        },
        onError: (error) => (this.error = error instanceof Error ? error.message : String(error)),
      },
    )
  }

  removeTester(channel: "beta" | "ai-gilde", user: string) {
    this.saveMutation.mutate(
      {
        betaUsers: channel === "beta" ? this.betaUsers.filter((item) => item !== user) : this.betaUsers,
        aiGildeUsers: channel === "ai-gilde" ? this.aiGildeUsers.filter((item) => item !== user) : this.aiGildeUsers,
      },
      {
        onSuccess: () => {
          this.status = user + " removed from " + (channel === "beta" ? "beta" : "AI-Gilde") + " testers."
        },
        onError: (error) => (this.error = error instanceof Error ? error.message : String(error)),
      },
    )
  }

  get betaUsers() {
    return this.testersQuery.data()?.betaUsers ?? []
  }

  get aiGildeUsers() {
    return this.testersQuery.data()?.aiGildeUsers ?? []
  }
}
