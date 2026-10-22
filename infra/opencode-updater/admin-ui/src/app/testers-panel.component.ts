import { Component, effect, inject, signal } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { injectMutation, injectQuery, injectQueryClient } from "@tanstack/angular-query-experimental"
import { ApiService, TesterSearchEntry, Testers } from "./api.service"

@Component({
  selector: "app-testers-panel",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./testers-panel.component.html",
  styleUrl: "./testers-panel.component.css",
})
export class TestersPanelComponent {
  readonly api = inject(ApiService)
  readonly queryClient = injectQueryClient()
  readonly testersQuery = injectQuery(() => ({
    queryKey: ["testers"],
    queryFn: () => this.api.listTesters(),
  }))
  readonly saveMutation = injectMutation(() => ({
    mutationFn: (payload: Testers) => this.api.saveTesters(payload),
  }))
  readonly searchMutation = injectMutation(() => ({
    mutationFn: (term: string) => this.api.searchTesters(term),
  }))

  searchTerm = signal("")
  betaUsers = signal<string[]>([])
  aiGildeUsers = signal<string[]>([])
  betaGroups = signal<string[]>([])
  aiGildeGroups = signal<string[]>([])
  searchResults = signal<TesterSearchEntry[]>([])
  searchCompleted = signal(false)
  status = signal("")
  error = signal("")

  constructor() {
    effect(() => {
      const data = this.testersQuery.data()
      if (!data) return
      this.betaUsers.set(data.betaUsers)
      this.aiGildeUsers.set(data.aiGildeUsers)
      this.betaGroups.set(data.betaGroups)
      this.aiGildeGroups.set(data.aiGildeGroups)
    })
  }

  ready() {
    return this.testersQuery.isSuccess() && !this.saveMutation.isPending() && !this.searchMutation.isPending()
  }

  search(event: Event) {
    event.preventDefault()
    if (!this.ready()) return
    const term = this.searchTerm().trim()
    if (!term) {
      this.error.set("Enter a key name to search.")
      return
    }
    this.error.set("")
    this.status.set("Searching…")
    this.searchMutation.mutate(term, {
      onSuccess: (response) => {
        this.status.set("")
        this.searchResults.set(response.results)
        this.searchCompleted.set(true)
      },
      onError: (error) => {
        this.status.set("")
        this.error.set(error instanceof Error ? error.message : String(error))
      },
    })
  }

  save(payload: Testers, successMessage: string) {
    if (!this.ready()) return
    this.error.set("")
    this.status.set("Saving…")
    this.saveMutation.mutate(payload, {
      onSuccess: async (response) => {
        this.status.set(successMessage)
        this.applySavedTesters(response)
        this.queryClient.setQueryData(["testers"], response)
        await this.queryClient.invalidateQueries({ queryKey: ["testers"] })
      },
      onError: (error) => {
        this.status.set("")
        this.error.set(error instanceof Error ? error.message : String(error))
      },
    })
  }

  applySavedTesters(data: Testers) {
    this.betaUsers.set(data.betaUsers)
    this.aiGildeUsers.set(data.aiGildeUsers)
    this.betaGroups.set(data.betaGroups)
    this.aiGildeGroups.set(data.aiGildeGroups)
    this.searchResults.update((results) =>
      results.map((entry) => ({
        ...entry,
        currentChannel: data.betaUsers.some((user) => user.toLowerCase() === entry.userName.toLowerCase())
          ? "beta"
          : data.aiGildeUsers.some((user) => user.toLowerCase() === entry.userName.toLowerCase())
            ? "ai-gilde"
            : "none",
      })),
    )
  }

  testerPayload(channel: "beta" | "ai-gilde", user: string) {
    return {
      ...this.currentPayload(),
      betaUsers: [
        ...this.betaUsers().filter((item) => item.toLowerCase() !== user.toLowerCase()),
        ...(channel === "beta" ? [user] : []),
      ],
      aiGildeUsers: [
        ...this.aiGildeUsers().filter((item) => item.toLowerCase() !== user.toLowerCase()),
        ...(channel === "ai-gilde" ? [user] : []),
      ],
    }
  }

  addTester(channel: "beta" | "ai-gilde", user: string) {
    this.save(
      this.testerPayload(channel, user),
      user + " added to " + (channel === "beta" ? "beta" : "AI-Gilde") + " testers.",
    )
  }

  removeTester(channel: "beta" | "ai-gilde", user: string) {
    this.save(
      {
        ...this.currentPayload(),
        betaUsers:
          channel === "beta"
            ? this.betaUsers().filter((item) => item.toLowerCase() !== user.toLowerCase())
            : this.betaUsers(),
        aiGildeUsers:
          channel === "ai-gilde"
            ? this.aiGildeUsers().filter((item) => item.toLowerCase() !== user.toLowerCase())
            : this.aiGildeUsers(),
      },
      user + " removed from " + (channel === "beta" ? "beta" : "AI-Gilde") + " testers.",
    )
  }

  currentPayload() {
    return {
      betaUsers: this.betaUsers(),
      betaGroups: this.betaGroups(),
      aiGildeUsers: this.aiGildeUsers(),
      aiGildeGroups: this.aiGildeGroups(),
    }
  }
}
