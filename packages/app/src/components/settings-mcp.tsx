import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, For, Show, type Component } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { DialogMcpForm } from "./dialog-mcp-form"
import { SettingsList } from "./settings-list"
import { hideMcpName, showMcpName } from "./mcp-ui-state"
import type { McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk/v2/client"

type McpConfig = McpLocalConfig | McpRemoteConfig

export const SettingsMcp: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSync = useGlobalSync()

  const servers = createMemo(() =>
    Object.entries(globalSync.data.config.mcp ?? {})
      .filter(([, config]) => config.type === "local" || config.type === "remote")
      .map(([name, config]) => ({ name, config: config as McpConfig }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const subtitle = (config: McpConfig) =>
    config.type === "local" ? config.command.join(" ") : config.url

  const deleteServer = async (name: string) => {
    const existing = { ...(globalSync.data.config.mcp ?? {}) }
    delete existing[name]
    hideMcpName(name)
    await globalSync
      .updateConfig({ mcp: existing })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.mcp.toast.deleted.title"),
          description: language.t("settings.mcp.toast.deleted.description", { name }),
        })
      })
      .catch((err: unknown) => {
        showMcpName(name)
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex items-center justify-between pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.mcp.title")}</h2>
          <Button
            size="large"
            variant="secondary"
            icon="plus-small"
            onClick={() => dialog.show(() => <DialogMcpForm />)}
          >
            {language.t("settings.mcp.add")}
          </Button>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <SettingsList>
          <Show
            when={servers().length > 0}
            fallback={
              <div class="py-4 text-14-regular text-text-weak">{language.t("settings.mcp.empty")}</div>
            }
          >
            <For each={servers()}>
              {(item) => (
                <div class="group flex items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                  <div class="flex flex-col gap-0.5 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-14-medium text-text-strong truncate">{item.name}</span>
                      <Tag>
                        {item.config.type === "local"
                          ? language.t("settings.mcp.server.type.local")
                          : language.t("settings.mcp.server.type.remote")}
                      </Tag>
                    </div>
                    <span class="text-12-regular text-text-weak truncate">{subtitle(item.config)}</span>
                  </div>
                  <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <Button
                      size="large"
                      variant="ghost"
                      onClick={() => dialog.show(() => <DialogMcpForm name={item.name} config={item.config} />)}
                    >
                      {language.t("common.edit")}
                    </Button>
                    <Button size="large" variant="ghost" onClick={() => void deleteServer(item.name)}>
                      {language.t("common.delete")}
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </SettingsList>
      </div>
    </div>
  )
}
