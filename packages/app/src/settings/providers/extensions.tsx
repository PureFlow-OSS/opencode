import { Component, For, Show, createEffect, createMemo, createResource, onCleanup } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { useDialog } from "@opencode/ui/context/dialog"
import { Tabs } from "@opencode/ui/tabs"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData, useServer } from "@/runtime/server/current"
import { pluginLabel, pluginRepairContext } from "@/providers/catalog/plugin"
import { ExternalLink } from "@/runtime/platform/external-link"
import { useTabs } from "@/shell/tabs/tabs"
import { SettingsList } from "@/settings/list"
import { SettingsMcp } from "@/settings/mcp/mcp"
import type { SettingsView } from "@/settings/surface"
import type { PluginInfo } from "@opencode/client"
import { ServerConnection } from "@/runtime/server/registry"
import "@/settings/settings.css"

export const SettingsExtensions: Component<{
  subtab?: SettingsView["subtab"]
  onSubtab: (value: SettingsView["subtab"]) => void
}> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSdk = useServerSDK()
  const data = useData()

  // Reading `.latest` rethrows a failed fetch, so these lists fall back to empty instead of crashing the page.
  const [pluginList, { refetch }] = createResource(
    () => serverSdk.connection.status() === "connected",
    () =>
      serverSdk.api.plugin
        .list()
        .then((result) => result.data)
        .catch(() => []),
    { initialValue: [] },
  )

  const plugins = createMemo(() =>
    pluginList.state === "ready" || pluginList.state === "refreshing"
      ? pluginList.latest.filter((plugin) => plugin.source.type !== "builtin")
      : [],
  )

  onCleanup(serverSdk.event.on("plugin.updated", () => void refetch()))

  createEffect(() => {
    if (serverSdk.connection.status() !== "connected") return
    void data.location.skill.sync().catch(() => undefined)
  })
  const skills = () => data.location.skill.list() ?? []

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.extensions")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.extensions.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body">
        <Tabs
          variant="pill"
          value={props.subtab ?? "mcps"}
          onChange={(value) => {
            if (value === "mcps" || value === "plugins" || value === "skills") props.onSubtab(value)
          }}
          class="settings-extensions-tabs settings-subtabs"
        >
          <Tabs.List>
            <Tabs.Trigger value="mcps">{language.t("settings.extensions.tab.mcps")}</Tabs.Trigger>
            <Tabs.Trigger value="plugins">{language.t("settings.extensions.tab.plugins")}</Tabs.Trigger>
            <Tabs.Trigger value="skills">{language.t("settings.extensions.tab.skills")}</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="mcps">
            <SettingsMcp />
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <span class="text-13-regular text-v2-text-text-muted">
                  {language.t("settings.extensions.manageConfig")}
                </span>
              </div>
              <SettingsList variant="catalog">
                <For each={plugins()}>
                  {(plugin) => (
                    <div class="settings-extension-row">
                      <div class="settings-extension-lead">
                        <Icon name="cube" class="text-v2-icon-icon-muted shrink-0" />
                        <div class="flex min-w-0 flex-col gap-0.5">
                          <span class="settings-extension-name truncate">{pluginLabel(plugin)}</span>
                          <Show when={plugin.state.status === "failed"}>
                            <span class="text-11-regular text-v2-state-fg-danger">
                              {language.t("settings.extensions.plugin.failed")}
                            </span>
                            <span class="truncate text-11-regular text-v2-text-text-muted">
                              {pluginRepairContext(plugin, data.location.default().directory)?.error}
                            </span>
                          </Show>
                        </div>
                      </div>
                      <Show when={plugin.state.status === "failed"}>
                        <Button
                          size="small"
                          variant="neutral"
                          onClick={() => {
                            const directory = data.location.default().directory

                            dialog.show(() => <DialogPluginRepair directory={directory} plugin={plugin} />)
                          }}
                        >
                          {language.t("settings.extensions.plugin.repair")}
                        </Button>
                      </Show>
                    </div>
                  )}
                </For>
              </SettingsList>
            </div>
          </Tabs.Content>

          <Tabs.Content value="skills">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <ExternalLink class="settings-extension-link text-13-regular" href="https://opencode.ai/docs/skills/">
                  {language.t("settings.extensions.addSkills")}
                </ExternalLink>
              </div>
              <SettingsList variant="catalog">
                <For each={skills()}>
                  {(skill) => (
                    <div class="settings-extension-row">
                      <div class="settings-extension-lead">
                        <Icon name="post-skill" class="text-v2-icon-icon-muted shrink-0" />
                        <span class="settings-extension-name truncate">{skill.name}</span>
                      </div>
                    </div>
                  )}
                </For>
              </SettingsList>
            </div>
          </Tabs.Content>
        </Tabs>
      </div>
    </>
  )
}

function DialogPluginRepair(props: { directory: string; plugin: PluginInfo }) {
  const language = useLanguage()
  const dialog = useDialog()
  const server = useServer()
  const tabs = useTabs()
  const context = pluginRepairContext(props.plugin, props.directory)

  const prepare = () => {
    if (!context) return

    dialog.close()
    void tabs.newDraft(
      { server: ServerConnection.key(server.ctx.sdk.server), directory: context.directory },
      language.t("settings.extensions.plugin.repairPrompt", {
        directory: context.directory,
        plugin: context.plugin,
        ref: context.errorRef ?? language.t("settings.extensions.plugin.noErrorRef"),
      }),
    )
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.extensions.plugin.repairDialog.title")}
          description={language.t("settings.extensions.plugin.repairDialog.description")}
        />
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button type="button" variant="contrast" onClick={prepare}>
          {language.t("settings.extensions.plugin.repairDialog.confirm")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
