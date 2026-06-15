import { Component } from "@angular/core"
import { UploadPanelComponent } from "./upload-panel.component"
import { FeedbackPanelComponent } from "./feedback-panel.component"
import { AuditPanelComponent } from "./audit-panel.component"

@Component({
  selector: "app-root",
  standalone: true,
  imports: [UploadPanelComponent, FeedbackPanelComponent, AuditPanelComponent],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {}
