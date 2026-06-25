import { Component } from "@angular/core"
import { UploadPanelComponent } from "./upload-panel.component"
import { FeedbackPanelComponent } from "./feedback-panel.component"
import { AuditPanelComponent } from "./audit-panel.component"
import { ModelStatusPanelComponent } from "./model-status-panel.component"

type Page = "upload" | "beta-feedback" | "inbox" | "model-status"

@Component({
  selector: "app-root",
  standalone: true,
  imports: [UploadPanelComponent, FeedbackPanelComponent, AuditPanelComponent, ModelStatusPanelComponent],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
  page: Page = "upload"

  show(page: Page) {
    this.page = page
  }
}
