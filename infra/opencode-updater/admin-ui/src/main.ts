import { bootstrapApplication } from "@angular/platform-browser"
import { AppComponent } from "./app/app.component"
import "zone.js"
import { QueryClient } from "@tanstack/query-core"
import { provideTanStackQuery } from "@tanstack/angular-query-experimental"

bootstrapApplication(AppComponent, {
  providers: [provideTanStackQuery(new QueryClient())],
})
