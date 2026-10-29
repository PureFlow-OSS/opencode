import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import type { Mcp } from "@opencode/schema/mcp"
import { createStore } from "solid-js/store"
import { DialogMcpForm } from "./dialogs"

export default {
  title: "OpenCode/Settings/MCP dialogs",
  id: "settings-mcp-dialogs",
}

function FormStory(props: { name: string; config: Mcp.ServerConfig; preset?: boolean }) {
  const dialog = useDialog()
  const [state, setState] = createStore({ saved: "", config: props.config })

  return (
    <>
      <Button
        onClick={() =>
          dialog.show(() => (
            <DialogMcpForm
              name={props.name}
              config={state.config}
              preset={props.preset}
              existingNames={new Set([props.name])}
              onSave={async (name, config) => {
                setState("config", config)
                setState("saved", JSON.stringify({ name, config }))
              }}
            />
          ))
        }
      >
        Edit MCP server
      </Button>
      <output aria-label="Saved MCP configuration">{state.saved}</output>
    </>
  )
}

export const StoreEdit = {
  render: () => (
    <FormStory
      name="Company search"
      preset
      config={{
        type: "remote",
        url: "https://mcp.example/search",
        headers: { "x-company-token": "previous-token" },
        oauth: false,
        codemode: false,
        protocol: "auto",
        timeout: { startup: 3000 },
      }}
    />
  ),
}

export const LocalEdit = {
  render: () => (
    <FormStory
      name="Local company tools"
      config={{
        type: "local",
        command: ["C:\\Program Files\\MCP\\server.exe", "--scope", "team space", "O'Brien", ""],
        cwd: "C:\\Company workspace",
        environment: { COMPANY_SCOPE: "local" },
        codemode: false,
        protocol: "auto",
        timeout: { startup: 3000, execution: 12000 },
      }}
    />
  ),
}

export const RemoteWithoutOauth = {
  render: () => (
    <FormStory
      name="Company PAT"
      config={{ type: "remote", url: "https://mcp.example/pat", headers: { "X-ADO-PAT": "test-token" } }}
    />
  ),
}

export const RemoteWithOauth = {
  render: () => (
    <FormStory
      name="Company CRM"
      config={{
        type: "remote",
        url: "https://mcp.example/crm",
        oauth: { client_id: "crm-client", client_secret: "crm-secret", scope: "read", callback_port: 23456 },
      }}
    />
  ),
}
