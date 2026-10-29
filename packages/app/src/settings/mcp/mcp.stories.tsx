import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { createSignal } from "solid-js"
import { SettingsExtensions } from "@/settings/providers/extensions"
import type { SettingsView } from "@/settings/surface"
import { deferMcpCatalog, mcpActivity, setMcpActivity } from "./mcp.fixture"

export default {
  title: "OpenCode/Settings/MCP",
  id: "settings-mcp",
}

export const Extensions = {
  render: () => {
    const [subtab, setSubtab] = createSignal<SettingsView["subtab"]>("mcps")
    const releaseCatalog = deferMcpCatalog()
    setMcpActivity({ running: false, writes: [] })

    return (
      <QueryClientProvider client={new QueryClient()}>
        <button onClick={releaseCatalog}>Load MCP catalog</button>
        <button onClick={() => setMcpActivity("running", true)}>Start agent action</button>
        <output aria-label="MCP writes">{JSON.stringify(mcpActivity.writes)}</output>
        <SettingsExtensions subtab={subtab()} onSubtab={setSubtab} />
      </QueryClientProvider>
    )
  },
}
