import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { createSignal } from "solid-js"
import { SettingsExtensions } from "@/settings/providers/extensions"
import type { SettingsView } from "@/settings/surface"
import { deferMcpCatalog } from "./mcp.fixture"

export default {
  title: "OpenCode/Settings/MCP",
  id: "settings-mcp",
}

export const Extensions = {
  render: () => {
    const [subtab, setSubtab] = createSignal<SettingsView["subtab"]>("mcps")
    const releaseCatalog = deferMcpCatalog()
    return (
      <QueryClientProvider client={new QueryClient()}>
        <button onClick={releaseCatalog}>Load MCP catalog</button>
        <SettingsExtensions subtab={subtab()} onSubtab={setSubtab} />
      </QueryClientProvider>
    )
  },
}
