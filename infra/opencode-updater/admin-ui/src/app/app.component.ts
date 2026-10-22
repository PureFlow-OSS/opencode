import { Component } from "@angular/core"
import { UploadPanelComponent } from "./upload-panel.component"
import { AuditPanelComponent } from "./audit-panel.component"
import { ModelStatusPanelComponent } from "./model-status-panel.component"
import { McpPanelComponent } from "./mcp-panel.component"
import { McpStorePanelComponent } from "./mcp-store-panel.component"
import { TestersPanelComponent } from "./testers-panel.component"

type Page = "upload" | "releases" | "model-status" | "mcp" | "mcp-store" | "testers"

@Component({
  selector: "app-root",
  standalone: true,
  imports: [UploadPanelComponent, AuditPanelComponent, ModelStatusPanelComponent, McpPanelComponent, McpStorePanelComponent, TestersPanelComponent],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
  page: Page = "upload"

  show(page: Page) {
    this.page = page
  }
}
