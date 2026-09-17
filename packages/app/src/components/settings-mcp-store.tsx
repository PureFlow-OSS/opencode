import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Tag } from "@opencode-ai/ui/tag"
import { createMemo, createResource, For, Show, type Component } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { DialogMcpForm } from "./dialog-mcp-form"
import { SettingsList } from "./settings-list"

const UPDATE_SERVER_BASE_URL = (import.meta.env.OPENCODE_UPDATE_BASE_URL ?? "http://10.53.7.23/opencode")
  .trim()
  .replace(/\/+$/, "")
const MCP_STORE_URL = `${UPDATE_SERVER_BASE_URL}/mcp-store.json`

type McpStoreItem = {
  name: string
  description?: string
  url: string
  headerNames: string[]
  headerPlaceholder?: string
}

export const SettingsMcpStore: Component = () => {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const [items, { refetch }] = createResource(async () => {
    const response = await fetch(MCP_STORE_URL)
    if (!response.ok) throw new Error(`MCP Store request failed (${response.status})`)
    return response.json() as Promise<McpStoreItem[]>
  })
  const installed = createMemo(() => new Set(Object.keys(globalSync().data.config.mcp ?? {})))

  const add = (item: McpStoreItem) => {
    dialog.show(() => (
      <DialogMcpForm
        preset
        name={item.name}
        config={{
          type: "remote",
          url: item.url,
          headers: Object.fromEntries(item.headerNames.map((header) => [header, ""])),
          enabled: true,
        }}
        lockedHeaderNames={item.headerNames}
        headerValuePlaceholder={item.headerPlaceholder}
      />
    ))
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
          <h2 class="text-16-medium text-text-strong">MCP Store</h2>
          <p class="text-13-regular text-text-weak">Add optional MCP servers provided by your organization.</p>
        </div>
      </div>

      <SettingsList>
        <Show
          when={!items.loading}
          fallback={<div class="py-4 text-14-regular text-text-weak">Loading MCP Store…</div>}
        >
          <Show
            when={!items.error}
            fallback={
              <div class="flex items-center justify-between gap-4 py-4">
                <span class="text-14-regular text-text-weak">The MCP Store could not be loaded.</span>
                <Button size="large" variant="secondary" onClick={() => void refetch()}>
                  Retry
                </Button>
              </div>
            }
          >
            <Show
              when={(items.latest ?? []).length > 0}
              fallback={<div class="py-4 text-14-regular text-text-weak">No MCP servers are currently available.</div>}
            >
              <For each={items.latest ?? []}>
                {(item) => (
                  <div class="flex items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                    <div class="flex flex-col gap-0.5 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-14-medium text-text-strong truncate">{item.name}</span>
                        <Tag>Remote</Tag>
                      </div>
                      <Show when={item.description}>
                        {(description) => <span class="text-12-regular text-text-weak">{description()}</span>}
                      </Show>
                      <span class="text-12-regular text-text-weak truncate">{item.url}</span>
                    </div>
                    <Button
                      size="large"
                      variant="secondary"
                      icon={installed().has(item.name) ? "circle-check" : "plus-small"}
                      disabled={installed().has(item.name)}
                      onClick={() => add(item)}
                    >
                      {installed().has(item.name) ? "Added" : "Add"}
                    </Button>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </SettingsList>
    </div>
  )
}
