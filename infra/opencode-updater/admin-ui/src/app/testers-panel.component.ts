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
    mutationFn: (payload: { betaUsers: string[]; betaGroups: string[]; aiGildeUsers: string[]; aiGildeGroups: string[] }) => this.api.saveTesters(payload),
  }))

  betaUsers = ""
  betaGroups = ""
  aiGildeUsers = ""
  aiGildeGroups = ""
  status = ""
  error = ""

  constructor() {
    void this.testersQuery.refetch()
    effect(() => {
      const data = this.testersQuery.data()
      if (!data || this.saveMutation.isPending()) return
      this.betaUsers = data.betaUsers.join("\n")
      this.betaGroups = data.betaGroups.join("\n")
      this.aiGildeUsers = data.aiGildeUsers.join("\n")
      this.aiGildeGroups = data.aiGildeGroups.join("\n")
    })
  }

  parseList(value: string) {
    return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter((item) => item.length > 0))]
  }

  submit(event: Event) {
    event.preventDefault()
    this.error = ""
    this.status = "Saving…"
    this.saveMutation.mutate(
      {
        betaUsers: this.parseList(this.betaUsers),
        betaGroups: this.parseList(this.betaGroups),
        aiGildeUsers: this.parseList(this.aiGildeUsers),
        aiGildeGroups: this.parseList(this.aiGildeGroups),
      },
      {
        onSuccess: async () => {
          this.status = "Tester lists saved."
          await this.testersQuery.refetch()
        },
        onError: (error) => {
          this.status = ""
          this.error = error instanceof Error ? error.message : String(error)
        },
      },
    )
  }
}
