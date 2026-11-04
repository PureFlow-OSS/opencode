import { Component, signal } from "@angular/core"
import { UploadPanelComponent } from "./upload-panel.component"
import { AuditPanelComponent } from "./audit-panel.component"
import { ModelStatusPanelComponent } from "./model-status-panel.component"
import { McpPanelComponent } from "./mcp-panel.component"
import { McpStorePanelComponent } from "./mcp-store-panel.component"
import { PluginStorePanelComponent } from "./plugin-store-panel.component"
import { TestersPanelComponent } from "./testers-panel.component"
import { ApiService, type AdminSession } from "./api.service"

type Page = "upload" | "releases" | "model-status" | "mcp" | "mcp-store" | "plugin-store" | "testers"

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    UploadPanelComponent,
    AuditPanelComponent,
    ModelStatusPanelComponent,
    McpPanelComponent,
    McpStorePanelComponent,
    PluginStorePanelComponent,
    TestersPanelComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
  page: Page = "upload"
  readonly session = signal<AdminSession | undefined>(undefined)
  readonly authenticationError = signal("")

  constructor(api: ApiService) {
    void api
      .session()
      .then((session) => {
        this.session.set(session)
      })
      .catch((error) => {
        this.authenticationError.set(
          error instanceof Error ? error.message : "Die Anmeldung konnte nicht geprüft werden.",
        )
      })
  }

  show(page: Page) {
    this.page = page
  }
}
